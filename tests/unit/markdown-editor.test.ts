import { describe, expect, it, vi } from 'vitest';
import {
  EditorFileError,
  type EditorFileBaseline,
} from '../../src/editor/editor-file-io.js';
import {
  enterDialog,
  isDialogActive,
  leaveDialog,
} from '../../src/utils/dialog-state.js';

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));
const dialogMocks = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../src/screen/toast.js', () => toastMocks);
vi.mock('../../src/screen/dialog/confirm-dialog.js', () => dialogMocks);
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { MarkdownEditor } from '../../src/editor/markdown-editor.js';

function baseline(hash = 'old-hash'): EditorFileBaseline {
  return {
    contentHash: hash,
    mode: 0o644,
    device: 1,
    inode: 2,
    userId: 501,
    groupId: 20,
    hasBom: false,
    lineEnding: '\n',
    hadFinalNewline: false,
  };
}

function createHarness(fileIO: { load?: ReturnType<typeof vi.fn>; save?: ReturnType<typeof vi.fn> }) {
  const screen = {
    render: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const container = {
    destroy: vi.fn(),
    focus: vi.fn(),
    visible: true,
  };
  screen.focused = container;
  const onClose = vi.fn();
  const editor = Object.create(MarkdownEditor.prototype) as any;
  Object.assign(editor, {
    screen,
    container,
    filePath: '/tmp/note.md',
    fileIO,
    baseline: null,
    lines: [''],
    modified: false,
    saveInFlight: null,
    keyHandlerInstalled: false,
    closed: false,
    inputSuspended: false,
    dialogStateOwned: false,
    cursorRow: 0,
    cursorCol: 0,
    scrollOffset: 0,
    onClose,
    setupKeys: vi.fn(),
    render: vi.fn(),
  });
  return { editor, screen, container, onClose };
}

function createInteractionHarness(lines: string[]) {
  const { editor, screen, container, onClose } = createHarness({});
  const handlers = new Map<string, (...args: any[]) => unknown>();
  container.key = vi.fn((keys: string[], handler: (...args: any[]) => unknown) => {
    for (const key of keys) handlers.set(key, handler);
  });
  Object.assign(editor, {
    lines: [...lines],
    tabSize: 2,
    theme: {},
    render: vi.fn(),
    handleKeypress: vi.fn(),
  });
  (MarkdownEditor.prototype as any).setupKeys.call(editor);
  return { editor, screen, container, onClose, handlers };
}

describe('MarkdownEditor safe lifecycle', () => {
  it('returns false, destroys the overlay, restores focus, and installs no keys on load failure', async () => {
    toastMocks.showErrorToast.mockClear();
    const load = vi.fn().mockRejectedValue(
      new EditorFileError('symlink', 'Symbolic links cannot be edited'),
    );
    const { editor, screen, container, onClose } = createHarness({ load });

    const opened = await editor.open();

    expect(opened).toBe(false);
    expect(container.destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(editor.setupKeys).not.toHaveBeenCalled();
    expect(screen.on).not.toHaveBeenCalled();
    expect(toastMocks.showErrorToast).toHaveBeenCalledWith(
      screen,
      'Cannot edit note.md: Symbolic links cannot be edited',
    );
  });

  it('returns true and retains the loaded baseline on success', async () => {
    const loadedBaseline = baseline();
    const load = vi.fn().mockResolvedValue({
      content: 'first\nsecond\n',
      baseline: loadedBaseline,
    });
    const { editor, container } = createHarness({ load });

    const opened = await editor.open();

    expect(opened).toBe(true);
    expect(editor.lines).toEqual(['first', 'second', '']);
    expect(editor.baseline).toBe(loadedBaseline);
    expect(editor.setupKeys).toHaveBeenCalledOnce();
    expect(container.focus).toHaveBeenCalledOnce();
  });

  it('collapses concurrent saves and updates the baseline once', async () => {
    toastMocks.showToast.mockClear();
    let resolveSave!: (value: EditorFileBaseline) => void;
    const nextBaseline = baseline('new-hash');
    const save = vi.fn().mockReturnValue(new Promise<EditorFileBaseline>((resolve) => {
      resolveSave = resolve;
    }));
    const { editor, screen } = createHarness({ save });
    editor.baseline = baseline();
    editor.lines = ['edited'];
    editor.modified = true;

    const first = editor.save();
    const second = editor.save();

    expect(first).toBe(second);
    expect(save).toHaveBeenCalledOnce();
    resolveSave(nextBaseline);
    await first;

    expect(editor.baseline).toBe(nextBaseline);
    expect(editor.modified).toBe(false);
    expect(toastMocks.showToast).toHaveBeenCalledWith(screen, 'Saved note.md');
  });

  it('keeps modified state and the old baseline after a failed save', async () => {
    toastMocks.showErrorToast.mockClear();
    const originalBaseline = baseline();
    const save = vi.fn().mockRejectedValue(
      new EditorFileError('changed', 'The file changed outside Agents Commander; reload before saving'),
    );
    const { editor, screen } = createHarness({ save });
    editor.baseline = originalBaseline;
    editor.lines = ['edited'];
    editor.modified = true;

    const saved = await editor.save();

    expect(saved).toBe(false);
    expect(editor.modified).toBe(true);
    expect(editor.baseline).toBe(originalBaseline);
    expect(toastMocks.showErrorToast).toHaveBeenCalledWith(
      screen,
      'Save failed: The file changed outside Agents Commander; reload before saving',
    );
  });

  it('keeps newer edits modified when text changes during a successful save', async () => {
    let resolveSave!: (value: EditorFileBaseline) => void;
    const save = vi.fn().mockReturnValue(new Promise<EditorFileBaseline>((resolve) => {
      resolveSave = resolve;
    }));
    const { editor } = createHarness({ save });
    editor.baseline = baseline();
    editor.lines = ['first edit'];
    editor.modified = true;

    const pending = editor.save();
    editor.lines = ['newer edit'];
    resolveSave(baseline('saved-first-edit'));
    await pending;

    expect(save).toHaveBeenCalledWith('/tmp/note.md', 'first edit', expect.any(Object));
    expect(editor.modified).toBe(true);
    expect(editor.baseline.contentHash).toBe('saved-first-edit');
  });

  it('moves and deletes on grapheme boundaries without splitting emoji or combining text', () => {
    const line = `A👩‍💻e\u0301Z`;
    const { editor, handlers } = createInteractionHarness([line]);
    editor.cursorCol = line.length;

    handlers.get('left')?.();
    expect(editor.cursorCol).toBe(line.length - 1);
    handlers.get('left')?.();
    expect(editor.cursorCol).toBe(6);
    handlers.get('backspace')?.();

    expect(editor.lines[0]).toBe(`Ae\u0301Z`);
    expect(editor.cursorCol).toBe(1);

    editor.lines = [line];
    editor.cursorCol = 1;
    handlers.get('delete')?.();
    expect(editor.lines[0]).toBe(`Ae\u0301Z`);
    expect(editor.cursorCol).toBe(1);
  });

  it('renders cursor styling while escaping file text that resembles Blessed tags', () => {
    const { editor, screen } = createHarness({});
    const editorBox = {
      height: 5,
      width: 40,
      setContent: vi.fn(),
    };
    const lineNumbers = { setContent: vi.fn() };
    const statusLine = { setContent: vi.fn() };
    Object.assign(editor, {
      editorBox,
      lineNumbers,
      statusLine,
      lines: ['x{red-fg}👩‍💻'],
      cursorCol: 0,
      filePath: '/tmp/{bold}note.md',
    });

    (MarkdownEditor.prototype as any).render.call(editor);

    const rendered = editorBox.setContent.mock.calls[0][0] as string;
    expect(rendered).toContain('{black-fg}{cyan-bg}');
    expect(rendered).toContain('{open}red-fg{close}');
    expect(rendered).not.toContain('x{red-fg}');
    const status = statusLine.setContent.mock.calls[0][0] as string;
    expect(status).toContain('｛bold｝note.md');
    expect(status).not.toContain('{bold}');
    expect(screen.render).toHaveBeenCalled();
  });

  it('suspends global character input while the unsaved-changes dialog is open', async () => {
    let resolveConfirm!: (value: boolean) => void;
    dialogMocks.showConfirmDialog.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolveConfirm = resolve;
    }));
    const { editor, container, handlers } = createInteractionHarness(['draft']);
    editor.modified = true;
    editor.cursorCol = 5;

    const closing = handlers.get('escape')?.() as Promise<void>;
    await vi.waitFor(() => {
      expect(dialogMocks.showConfirmDialog).toHaveBeenCalledOnce();
    });
    (MarkdownEditor.prototype as any).handleEditorKeypress.call(
      editor,
      'y',
      { name: 'y' },
    );

    expect(editor.lines).toEqual(['draft']);
    resolveConfirm(false);
    await closing;
    expect(editor.inputSuspended).toBe(false);
    expect(container.focus).toHaveBeenCalledOnce();
  });

  it('accepts character input only while the editor or one of its children has focus', () => {
    const { editor, screen, container } = createInteractionHarness(['draft']);
    editor.cursorCol = 5;
    screen.focused = { parent: screen };

    (MarkdownEditor.prototype as any).handleEditorKeypress.call(
      editor,
      '!',
      { name: '!' },
    );
    expect(editor.lines).toEqual(['draft']);

    screen.focused = { parent: container };
    (MarkdownEditor.prototype as any).handleEditorKeypress.call(
      editor,
      '!',
      { name: '!' },
    );
    expect(editor.lines).toEqual(['draft!']);
  });

  it('releases its shared dialog state exactly once when destroyed', () => {
    const { editor } = createHarness({});
    enterDialog();
    editor.dialogStateOwned = true;
    expect(isDialogActive()).toBe(true);

    (MarkdownEditor.prototype as any).destroyAndRestoreFocus.call(editor);
    expect(isDialogActive()).toBe(false);
    (MarkdownEditor.prototype as any).destroyAndRestoreFocus.call(editor);
    expect(isDialogActive()).toBe(false);

    // Keep this test isolated if an assertion above ever interrupts cleanup.
    while (isDialogActive()) leaveDialog();
  });
});
