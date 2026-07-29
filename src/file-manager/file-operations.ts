import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ProgressCallback = (current: number, total: number, name: string) => void;
export type FileOperationKind = 'copy' | 'move' | 'delete' | 'mkdir';

export interface FileOperationContext {
  operation: FileOperationKind;
  source?: string;
  destination?: string;
  completed: number;
  total: number;
}

export class FileOperationError extends Error {
  readonly operation: FileOperationKind;
  readonly source?: string;
  readonly destination?: string;
  readonly completed: number;
  readonly total: number;
  readonly code?: string;
  readonly recoveryPath?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    context: FileOperationContext,
    options: { code?: string; cause?: unknown; recoveryPath?: string } = {},
  ) {
    super(message);
    this.name = 'FileOperationError';
    this.operation = context.operation;
    this.source = context.source;
    this.destination = context.destination;
    this.completed = context.completed;
    this.total = context.total;
    this.code = options.code;
    this.recoveryPath = options.recoveryPath;
    this.cause = options.cause;
  }
}

export class FileConflictError extends FileOperationError {
  constructor(message: string, context: FileOperationContext, cause?: unknown) {
    super(message, context, { code: 'EEXIST', cause });
    this.name = 'FileConflictError';
  }
}

export class InvalidEntryNameError extends Error {
  readonly code = 'EINVAL';
  readonly value: string;

  constructor(value: string, reason: string) {
    super(`Invalid file name: ${reason}`);
    this.name = 'InvalidEntryNameError';
    this.value = value;
  }
}

type FileStat = Awaited<ReturnType<typeof fs.lstat>>;

interface PlannedTransfer {
  source: string;
  destination: string;
  stat: FileStat;
  noOp: boolean;
}

interface StagedSource {
  directory: string;
  source: string;
  stat: FileStat;
  symbolicLinkTarget?: string;
}

type DestinationCreation = 'linked' | 'renamed';

interface NativeRenameRuntime {
  executable: string;
  filesystemProbes: Map<string, Promise<void>>;
}

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function operationError(
  message: string,
  context: FileOperationContext,
  cause: unknown,
): FileOperationError {
  if (cause instanceof FileConflictError && cause.operation === context.operation) {
    return cause;
  }
  if (errnoCode(cause) === 'EEXIST') {
    return new FileConflictError(message, context, cause);
  }
  return new FileOperationError(message, context, {
    code: errnoCode(cause),
    cause,
  });
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function destinationKey(destination: string): string {
  const resolved = path.resolve(destination);
  // Most macOS installations use a case-insensitive filesystem. Treat names
  // that differ only by case as conflicts before any batch work starts.
  return process.platform === 'darwin' ? resolved.toLocaleLowerCase() : resolved;
}

function sameFileIdentity(left: FileStat, right: FileStat): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.isDirectory() === right.isDirectory()
    && left.isSymbolicLink() === right.isSymbolicLink();
}

const NO_REPLACE_RENAME_SCRIPT = String.raw`
import ctypes
import errno
import os
import signal
import sys

libc = ctypes.CDLL(None, use_errno=True)

def terminate(_signal_number, _frame):
    raise OSError(errno.ETIMEDOUT, "native rename helper timed out")

signal.signal(signal.SIGTERM, terminate)

if sys.platform.startswith("linux"):
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        sys.stderr.write("ENOTSUP")
        sys.exit(1)
    rename.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    def rename_no_replace(source, destination):
        return rename(-100, source, -100, destination, 1)
    probe_result = rename(-1, b"source", -1, b"destination", 1)
    probe_errno = ctypes.get_errno()
    probe_ok = probe_result == -1 and probe_errno == errno.EBADF
elif sys.platform == "darwin":
    rename = libc.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    def rename_no_replace(source, destination):
        return rename(source, destination, 0x00000004)
    probe_result = rename(
        b"/dev/null/agents-commander-source",
        b"/dev/null/agents-commander-destination",
        0x00000004,
    )
    probe_errno = ctypes.get_errno()
    probe_ok = probe_result == -1 and probe_errno in (errno.ENOENT, errno.ENOTDIR)
else:
    sys.stderr.write("ENOTSUP")
    sys.exit(1)

if sys.argv[1] == "--probe":
    if not probe_ok:
        sys.stderr.write(errno.errorcode.get(probe_errno, "EUNKNOWN"))
        sys.exit(1)
    sys.stdout.write(os.path.realpath(sys.executable))
    sys.exit(0)

if sys.argv[1] == "--filesystem-probe":
    parent = sys.argv[2]
    probe_directory = None
    probe_source = None
    probe_destination = None
    failure = None
    try:
        probe_directory = os.path.join(
            parent,
            ".agents-commander-rename-probe-" + os.urandom(12).hex(),
        )
        os.mkdir(probe_directory, 0o700)
        probe_source = os.path.join(probe_directory, "source")
        probe_destination = os.path.join(probe_directory, "destination")
        with open(probe_source, "xb") as source_file:
            source_file.write(b"source")
        with open(probe_destination, "xb") as destination_file:
            destination_file.write(b"destination")
        source_before = os.lstat(probe_source)
        destination_before = os.lstat(probe_destination)

        conflict_result = rename_no_replace(
            os.fsencode(probe_source),
            os.fsencode(probe_destination),
        )
        conflict_errno = ctypes.get_errno()
        if conflict_result != -1 or conflict_errno != errno.EEXIST:
            raise OSError(errno.ENOTSUP, "no-replace conflict semantics unavailable")
        source_after_conflict = os.lstat(probe_source)
        destination_after_conflict = os.lstat(probe_destination)
        with open(probe_source, "rb") as source_file:
            source_content = source_file.read()
        with open(probe_destination, "rb") as destination_file:
            destination_content = destination_file.read()
        if (
            (source_before.st_dev, source_before.st_ino)
            != (source_after_conflict.st_dev, source_after_conflict.st_ino)
            or (destination_before.st_dev, destination_before.st_ino)
            != (destination_after_conflict.st_dev, destination_after_conflict.st_ino)
            or source_content != b"source"
            or destination_content != b"destination"
        ):
            raise OSError(errno.EIO, "no-replace conflict modified probe entries")

        os.unlink(probe_destination)
        success_result = rename_no_replace(
            os.fsencode(probe_source),
            os.fsencode(probe_destination),
        )
        if success_result != 0:
            raise OSError(ctypes.get_errno(), "no-replace success path failed")
        destination_after_move = os.lstat(probe_destination)
        with open(probe_destination, "rb") as moved_file:
            moved_content = moved_file.read()
        if (
            (source_before.st_dev, source_before.st_ino)
            != (destination_after_move.st_dev, destination_after_move.st_ino)
            or moved_content != b"source"
        ):
            raise OSError(errno.EIO, "no-replace success path changed probe data")
        try:
            os.lstat(probe_source)
            raise OSError(errno.EIO, "no-replace success left the source in place")
        except FileNotFoundError:
            pass
    except OSError as error:
        failure = error.errno or errno.EIO
    finally:
        for entry in (probe_source, probe_destination):
            if entry is None:
                continue
            try:
                os.unlink(entry)
            except FileNotFoundError:
                pass
            except OSError as error:
                if failure is None:
                    failure = error.errno or errno.EIO
        if probe_directory is not None:
            try:
                os.rmdir(probe_directory)
            except FileNotFoundError:
                pass
            except OSError as error:
                if failure is None:
                    failure = error.errno or errno.EIO
    if failure is not None:
        sys.stderr.write(errno.errorcode.get(failure, "EUNKNOWN"))
        sys.exit(1)
    sys.exit(0)

source = os.fsencode(sys.argv[1])
destination = os.fsencode(sys.argv[2])
result = rename_no_replace(source, destination)
if result != 0:
    value = ctypes.get_errno()
    sys.stderr.write(errno.errorcode.get(value, "EUNKNOWN"))
    sys.exit(1)
`;

interface ExecFileFailure extends Error {
  code?: string | number;
  stderr?: string;
}

function runNativeRenameHelper(
  executable: string,
  arguments_: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-c', NO_REPLACE_RENAME_SCRIPT, ...arguments_],
      {
        encoding: 'utf8',
        maxBuffer: 1024,
        timeout: 5_000,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(String(stdout));
          return;
        }

        const reportedCode = String(stderr).trim();
        const wrapped = new Error(
          `Atomic no-replace rename failed: ${reportedCode || error.message}`,
        ) as ExecFileFailure;
        wrapped.code = /^E[A-Z0-9]+$/u.test(reportedCode)
          ? reportedCode
          : (error as ExecFileFailure).code;
        wrapped.stderr = String(stderr);
        reject(wrapped);
      },
    );
  });
}

async function prepareNativeRenameRuntime(
  context: FileOperationContext,
): Promise<NativeRenameRuntime> {
  try {
    const executable = (await runNativeRenameHelper('python3', ['--probe'])).trim();
    if (!path.isAbsolute(executable)) {
      throw Object.assign(
        new Error('Python capability probe did not return an absolute executable path'),
        { code: 'ENOTSUP' },
      );
    }
    return { executable, filesystemProbes: new Map() };
  } catch (error) {
    throw operationError(
      `Atomic move support is unavailable; ${context.source} was left untouched`,
      context,
      error,
    );
  }
}

async function ensureSourceFilesystemSupportsNoReplace(
  runtime: NativeRenameRuntime,
  source: string,
  context: FileOperationContext,
): Promise<void> {
  const sourceParent = path.dirname(path.resolve(source));
  let filesystemKey: string;
  try {
    const parentStat = await fs.stat(sourceParent);
    filesystemKey = String(parentStat.dev);
  } catch (error) {
    throw operationError(
      `Unable to inspect the source filesystem; ${source} was left untouched`,
      context,
      error,
    );
  }

  let probe = runtime.filesystemProbes.get(filesystemKey);
  if (probe === undefined) {
    probe = runNativeRenameHelper(
      runtime.executable,
      ['--filesystem-probe', sourceParent],
    ).then(() => undefined);
    runtime.filesystemProbes.set(filesystemKey, probe);
  }

  try {
    await probe;
  } catch (error) {
    runtime.filesystemProbes.delete(filesystemKey);
    throw operationError(
      `Atomic no-replace moves are unavailable on the source filesystem; ${source} was left untouched`,
      context,
      error,
    );
  }
}

async function renameNoReplace(
  runtime: NativeRenameRuntime,
  source: string,
  destination: string,
  context: FileOperationContext,
): Promise<void> {
  try {
    await runNativeRenameHelper(runtime.executable, [source, destination]);
  } catch (error) {
    if (errnoCode(error) === 'EXDEV') {
      throw new FileOperationError(
        `Cross-filesystem move was refused before publishing ${destination} because metadata cannot be preserved faithfully`,
        context,
        { code: 'EXDEV', cause: error },
      );
    }
    throw operationError(
      `Failed to move ${context.source} to ${destination} without replacing data`,
      context,
      error,
    );
  }
}

export function validateEntryName(name: string): string {
  if (name.trim().length === 0) {
    throw new InvalidEntryNameError(name, 'the name cannot be blank');
  }
  if (name.trim() === '.' || name.trim() === '..') {
    throw new InvalidEntryNameError(name, 'dot path segments are not allowed');
  }
  if (path.isAbsolute(name) || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw new InvalidEntryNameError(name, 'absolute paths are not allowed');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new InvalidEntryNameError(name, 'path separators are not allowed');
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new InvalidEntryNameError(name, 'control characters are not allowed');
  }
  return name;
}

async function readSourceStat(
  source: string,
  context: FileOperationContext,
): Promise<FileStat> {
  try {
    return await fs.lstat(source);
  } catch (error) {
    throw operationError(`Unable to read source: ${source}`, context, error);
  }
}

async function assertDestinationAvailable(
  destination: string,
  context: FileOperationContext,
): Promise<void> {
  try {
    await fs.lstat(destination);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    throw operationError(`Unable to inspect destination: ${destination}`, context, error);
  }
  throw new FileConflictError(`Destination already exists: ${destination}`, context);
}

async function prepareTransfer(
  operation: 'copy' | 'move',
  source: string,
  destination: string,
  completed: number,
  total: number,
): Promise<PlannedTransfer> {
  const context: FileOperationContext = {
    operation,
    source,
    destination,
    completed,
    total,
  };
  const stat = await readSourceStat(source, context);

  if (samePath(source, destination)) {
    if (operation === 'move') {
      return { source, destination, stat, noOp: true };
    }
    throw new FileConflictError('Cannot copy an item onto itself', context);
  }

  if (stat.isDirectory() && isPathInside(source, destination)) {
    throw new FileOperationError(
      'Cannot copy or move a directory into itself',
      context,
      { code: 'EINVAL' },
    );
  }

  await assertDestinationAvailable(destination, context);
  return { source, destination, stat, noOp: false };
}

async function performCopy(
  planned: PlannedTransfer,
  operation: 'copy' | 'move',
  completed: number,
  total: number,
): Promise<void> {
  const context: FileOperationContext = {
    operation,
    source: planned.source,
    destination: planned.destination,
    completed,
    total,
  };

  // Repeat the preflight immediately before writing. The filesystem operation
  // itself is also configured to fail rather than replace a raced destination.
  await assertDestinationAvailable(planned.destination, context);

  try {
    if (planned.stat.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(planned.source), planned.destination);
    } else if (planned.stat.isDirectory()) {
      // fs.cp() merges when its directory destination already exists, even
      // with force:false and errorOnExist:true. Claim the root atomically
      // first so a destination raced in after preflight is never modified.
      await fs.mkdir(planned.destination, {
        recursive: false,
        mode: Number(planned.stat.mode) & 0o777,
      });
      await fs.cp(planned.source, planned.destination, {
        recursive: true,
        dereference: false,
        force: false,
        errorOnExist: true,
      });
    } else {
      await fs.copyFile(planned.source, planned.destination, constants.COPYFILE_EXCL);
    }
  } catch (error) {
    throw operationError(
      `Failed to ${operation} ${planned.source} to ${planned.destination}`,
      context,
      error,
    );
  }
}

async function removeStagedSource(
  staged: StagedSource,
  context: FileOperationContext,
): Promise<void> {
  try {
    await fs.rm(staged.source, { recursive: true, force: false });
  } catch (error) {
    throw new FileOperationError(
      `Move completed, but the staged source could not be removed: ${staged.source}`,
      context,
      {
        code: errnoCode(error),
        cause: error,
        recoveryPath: staged.source,
      },
    );
  }
  await removeEmptyStagingDirectory(staged, context);
}

async function removeEmptyStagingDirectory(
  staged: StagedSource,
  context: FileOperationContext,
): Promise<void> {
  try {
    await fs.rmdir(staged.directory);
  } catch (error) {
    throw operationError(
      `Move completed, but its empty staging directory could not be removed: ${staged.directory}`,
      context,
      error,
    );
  }
}

async function createExclusiveDestination(
  runtime: NativeRenameRuntime,
  staged: StagedSource,
  destination: string,
  context: FileOperationContext,
): Promise<DestinationCreation> {
  if (staged.stat.isSymbolicLink()) {
    // A native no-replace rename keeps the symlink inode, owner, timestamps,
    // xattrs, and raw target intact without ever following that target.
    await renameNoReplace(runtime, staged.source, destination, context);
    return 'renamed';
  }

  // A hard link is an atomic, no-replace move primitive for regular files on
  // the same filesystem and preserves the inode, timestamps, ACLs, and xattrs.
  if (staged.stat.isFile()) {
    try {
      await fs.link(staged.source, destination);
      return 'linked';
    } catch (error) {
      const code = errnoCode(error);
      if (code === 'EEXIST') {
        throw operationError(
          `Failed to move ${context.source} to ${destination}`,
          context,
          error,
        );
      }
      if (code === 'EXDEV') {
        throw new FileOperationError(
          `Cross-filesystem move was refused before publishing ${destination} because file metadata cannot be preserved faithfully`,
          context,
          { code, cause: error },
        );
      }
    }
  }

  // Directories and special files require a true no-replace rename to retain
  // their complete metadata. Linux renameat2(RENAME_NOREPLACE) and macOS
  // renamex_np(RENAME_EXCL) provide that primitive. EXDEV is surfaced before
  // a destination is created rather than silently degrading move semantics.
  await renameNoReplace(runtime, staged.source, destination, context);
  return 'renamed';
}

async function verifyRenamedSymbolicLink(
  staged: StagedSource,
  destination: string,
  context: FileOperationContext,
): Promise<void> {
  if (staged.symbolicLinkTarget === undefined) {
    throw new FileOperationError(
      `Unable to verify moved symbolic link without its pinned target: ${destination}`,
      context,
      { code: 'ESTALE' },
    );
  }

  try {
    const destinationStat = await fs.lstat(destination);
    const destinationTarget = destinationStat.isSymbolicLink()
      ? await fs.readlink(destination)
      : undefined;
    if (
      !destinationStat.isSymbolicLink()
      || !sameFileIdentity(staged.stat, destinationStat)
      || destinationTarget !== staged.symbolicLinkTarget
    ) {
      throw new FileOperationError(
        `Symbolic-link destination changed while moving it: ${destination}`,
        context,
        { code: 'ESTALE' },
      );
    }
  } catch (error) {
    if (error instanceof FileOperationError) throw error;
    throw operationError(
      `Unable to verify symbolic-link destination: ${destination}`,
      context,
      error,
    );
  }
}

async function restoreStagedSource(
  runtime: NativeRenameRuntime,
  staged: StagedSource,
  originalSource: string,
  context: FileOperationContext,
): Promise<void> {
  const creation = await createExclusiveDestination(runtime, staged, originalSource, {
    ...context,
    source: staged.source,
    destination: originalSource,
  });
  if (creation === 'renamed') {
    if (staged.stat.isSymbolicLink()) {
      await verifyRenamedSymbolicLink(staged, originalSource, context);
    }
    await removeEmptyStagingDirectory(staged, context);
  } else {
    await removeStagedSource(staged, context);
  }
}

async function stageMoveSource(
  runtime: NativeRenameRuntime,
  planned: PlannedTransfer,
  context: FileOperationContext,
): Promise<StagedSource> {
  let stagingDirectory: string;
  try {
    stagingDirectory = await fs.mkdtemp(
      path.join(path.dirname(planned.source), '.agents-commander-move-'),
    );
    await fs.chmod(stagingDirectory, 0o700);
  } catch (error) {
    throw operationError(
      `Unable to create a private move staging directory for ${planned.source}`,
      context,
      error,
    );
  }

  const stagedSource = path.join(stagingDirectory, path.basename(planned.source));
  let sourceWasStaged = false;
  try {
    // The target is inside a newly-created private directory, so rename cannot
    // replace an unrelated item. Once staged, later users of the original
    // source path cannot cause us to delete their replacement.
    await fs.rename(planned.source, stagedSource);
    sourceWasStaged = true;
    const stagedStat = await fs.lstat(stagedSource);
    const symbolicLinkTarget = stagedStat.isSymbolicLink()
      ? await fs.readlink(stagedSource)
      : undefined;
    const staged = {
      directory: stagingDirectory,
      source: stagedSource,
      stat: stagedStat,
      symbolicLinkTarget,
    };

    if (!sameFileIdentity(planned.stat, stagedStat)) {
      try {
        await restoreStagedSource(runtime, staged, planned.source, context);
      } catch (restoreError) {
        throw new FileOperationError(
          `Source changed while preparing the move; the item remains safely staged at ${stagedSource}`,
          context,
          {
            code: 'ESTALE',
            cause: restoreError,
            recoveryPath: stagedSource,
          },
        );
      }
      throw new FileOperationError(
        `Source changed while preparing to move it: ${planned.source}`,
        context,
        { code: 'ESTALE' },
      );
    }

    return staged;
  } catch (error) {
    try {
      await fs.rmdir(stagingDirectory);
    } catch {
      // A non-empty staging directory contains the only safe copy of an item;
      // keep it in place rather than deleting data during error cleanup.
    }
    if (error instanceof FileOperationError) throw error;
    if (sourceWasStaged) {
      throw new FileOperationError(
        `Unable to inspect the staged source; the item may be recovered from ${stagedSource}`,
        context,
        {
          code: errnoCode(error),
          cause: error,
          recoveryPath: stagedSource,
        },
      );
    }
    throw operationError(
      `Unable to stage source before moving it: ${planned.source}`,
      context,
      error,
    );
  }
}

async function performMove(
  planned: PlannedTransfer,
  completed: number,
  total: number,
  preparedRuntime?: NativeRenameRuntime,
): Promise<void> {
  if (planned.noOp) return;

  const context: FileOperationContext = {
    operation: 'move',
    source: planned.source,
    destination: planned.destination,
    completed,
    total,
  };

  // Resolve an absolute interpreter and prove the native no-replace syscall
  // works before creating a staging directory or moving the source. All later
  // publication and restoration calls reuse this operation-scoped runtime, so
  // PATH changes after the probe cannot strand the source in staging.
  const runtime = preparedRuntime ?? await prepareNativeRenameRuntime(context);
  await ensureSourceFilesystemSupportsNoReplace(runtime, planned.source, context);
  await performMoveWithRuntime(runtime, planned, context);
}

async function performMoveWithRuntime(
  runtime: NativeRenameRuntime,
  planned: PlannedTransfer,
  context: FileOperationContext,
): Promise<void> {
  const staged = await stageMoveSource(runtime, planned, context);
  let creation: DestinationCreation;
  try {
    creation = await createExclusiveDestination(
      runtime,
      staged,
      planned.destination,
      context,
    );
  } catch (error) {
    throw await restoreAfterMoveFailure(
      staged,
      planned.source,
      context,
      runtime,
      operationError(
        `Failed to move ${planned.source} to ${planned.destination}`,
        context,
        error,
      ),
    );
  }

  try {
    if (creation === 'renamed' && staged.stat.isSymbolicLink()) {
      await verifyRenamedSymbolicLink(staged, planned.destination, context);
    }
    if (creation === 'renamed') {
      await removeEmptyStagingDirectory(staged, context);
    } else {
      await removeStagedSource(staged, context);
    }
  } catch (error) {
    if (error instanceof FileOperationError) throw error;
    throw operationError(`Failed to finalize move of ${planned.source}`, context, error);
  }
}

async function restoreAfterMoveFailure(
  staged: StagedSource,
  originalSource: string,
  context: FileOperationContext,
  runtime: NativeRenameRuntime,
  moveError: FileOperationError,
): Promise<FileOperationError> {
  try {
    await restoreStagedSource(runtime, staged, originalSource, context);
    return moveError;
  } catch (restoreError) {
    return new FileOperationError(
      `Move failed; the original remains safely staged at ${staged.source}`,
      context,
      {
        code: moveError.code ?? errnoCode(restoreError),
        cause: new AggregateError(
          [moveError, restoreError],
          `Move and automatic source restoration both failed`,
        ),
        recoveryPath: staged.source,
      },
    );
  }
}

function batchDestinations(
  operation: 'copy' | 'move',
  sources: string[],
  destinationDirectory: string,
): Array<{ source: string; destination: string }> {
  const total = sources.length;
  const seen = new Map<string, string>();

  return sources.map((source) => {
    const destination = path.join(destinationDirectory, path.basename(source));
    const key = destinationKey(destination);
    const previousSource = seen.get(key);
    if (previousSource !== undefined) {
      throw new FileConflictError(
        `Multiple sources map to the same destination: ${destination}`,
        {
          operation,
          source,
          destination,
          completed: 0,
          total,
        },
      );
    }
    seen.set(key, source);
    return { source, destination };
  });
}

async function prepareBatch(
  operation: 'copy' | 'move',
  sources: string[],
  destinationDirectory: string,
): Promise<PlannedTransfer[]> {
  const destinations = batchDestinations(operation, sources, destinationDirectory);
  const planned: PlannedTransfer[] = [];
  for (const item of destinations) {
    planned.push(await prepareTransfer(
      operation,
      item.source,
      item.destination,
      0,
      sources.length,
    ));
  }
  return planned;
}

export async function copyFile(source: string, destination: string): Promise<void> {
  const planned = await prepareTransfer('copy', source, destination, 0, 1);
  await performCopy(planned, 'copy', 0, 1);
}

export async function moveFile(source: string, destination: string): Promise<void> {
  const planned = await prepareTransfer('move', source, destination, 0, 1);
  await performMove(planned, 0, 1);
}

export async function deleteFile(filePath: string): Promise<void> {
  const context: FileOperationContext = {
    operation: 'delete',
    source: filePath,
    completed: 0,
    total: 1,
  };
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch (error) {
    throw operationError(`Failed to delete ${filePath}`, context, error);
  }
}

export async function createDirectory(directoryPath: string): Promise<void> {
  const context: FileOperationContext = {
    operation: 'mkdir',
    destination: directoryPath,
    completed: 0,
    total: 1,
  };
  try {
    await fs.mkdir(directoryPath, { recursive: false });
  } catch (error) {
    throw operationError(`Failed to create directory ${directoryPath}`, context, error);
  }
}

export async function copyFiles(
  sources: string[],
  destinationDirectory: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const planned = await prepareBatch('copy', sources, destinationDirectory);
  for (let index = 0; index < planned.length; index++) {
    await performCopy(planned[index], 'copy', index, planned.length);
    onProgress?.(index + 1, planned.length, path.basename(planned[index].source));
  }
}

export async function moveFiles(
  sources: string[],
  destinationDirectory: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const planned = await prepareBatch('move', sources, destinationDirectory);
  const firstTransfer = planned.find((transfer) => !transfer.noOp);
  const runtime = firstTransfer === undefined
    ? undefined
    : await prepareNativeRenameRuntime({
      operation: 'move',
      source: firstTransfer.source,
      destination: firstTransfer.destination,
      completed: 0,
      total: planned.length,
    });
  if (runtime !== undefined) {
    for (const transfer of planned) {
      if (transfer.noOp) continue;
      await ensureSourceFilesystemSupportsNoReplace(
        runtime,
        transfer.source,
        {
          operation: 'move',
          source: transfer.source,
          destination: transfer.destination,
          completed: 0,
          total: planned.length,
        },
      );
    }
  }
  for (let index = 0; index < planned.length; index++) {
    await performMove(planned[index], index, planned.length, runtime);
    onProgress?.(index + 1, planned.length, path.basename(planned[index].source));
  }
}

export async function deleteFiles(
  sources: string[],
  onProgress?: ProgressCallback,
): Promise<void> {
  for (let index = 0; index < sources.length; index++) {
    const context: FileOperationContext = {
      operation: 'delete',
      source: sources[index],
      completed: index,
      total: sources.length,
    };
    try {
      await fs.rm(sources[index], { recursive: true, force: true });
    } catch (error) {
      throw operationError(`Failed to delete ${sources[index]}`, context, error);
    }
    onProgress?.(index + 1, sources.length, path.basename(sources[index]));
  }
}
