#!/usr/bin/env python3
"""
PTY helper: allocates a real pseudo-terminal and runs the given command.
Proxies stdin/stdout so the parent process can communicate via pipes
while the child process sees a real TTY.

Usage: python3 pty-helper.py [--cwd PATH] -- <command> [args...]
"""
import sys
import os
import pty
import select
import signal
import errno
import fcntl
import struct
import termios
import time

CONTROL_FD = 3
MAX_TERMINAL_DIMENSION = 10000
PROCESS_GROUP_TERM_GRACE_SECONDS = 0.5
PROCESS_GROUP_KILL_GRACE_SECONDS = 0.5
CONTROL_SIGNALS = {
    'INT': signal.SIGINT,
    'TERM': signal.SIGTERM,
    'KILL': signal.SIGKILL,
}

def parse_args(argv):
    cwd = None
    args = list(argv)

    if args and args[0] == '--cwd':
        if len(args) < 2:
            print("Usage: pty-helper.py [--cwd PATH] -- <command> [args...]", file=sys.stderr)
            sys.exit(1)
        cwd = args[1]
        args = args[2:]

    if args and args[0] == '--':
        args = args[1:]

    if not args:
        print("Usage: pty-helper.py [--cwd PATH] -- <command> [args...]", file=sys.stderr)
        sys.exit(1)

    return cwd, args

def available_control_fd():
    try:
        os.fstat(CONTROL_FD)
        return CONTROL_FD
    except OSError:
        return None

def apply_resize(master_fd, cols, rows):
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    # On Darwin and Linux, TIOCSWINSZ delivers SIGWINCH to the foreground
    # process group. Sending another signal here would trigger duplicate redraws.
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

def signal_child_process_group(child_pid, signum, allow_pid_fallback=True):
    """Signal the PTY child's whole process group, including descendants."""
    try:
        # forkpty(3) makes the child a session/process-group leader, so its PID
        # is also the stable process-group id until it has been reaped.
        os.killpg(child_pid, signum)
    except ProcessLookupError:
        if not allow_pid_fallback:
            return
        try:
            os.kill(child_pid, signum)
        except OSError:
            pass
    except OSError:
        # Retain a narrow fallback for platforms where killpg is unavailable
        # or the child has not completed session setup yet.
        if not allow_pid_fallback:
            return
        try:
            os.kill(child_pid, signum)
        except OSError:
            pass

def child_process_group_exists(child_pid):
    try:
        os.killpg(child_pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError as exc:
        return exc.errno != errno.ESRCH

def poll_child(child_pid):
    """Return (reaped, status), without ever blocking the helper."""
    try:
        result = os.waitpid(child_pid, os.WNOHANG)
    except ChildProcessError:
        return True, None
    except OSError as exc:
        if exc.errno == errno.ECHILD:
            return True, None
        return False, None
    if result[0] == 0:
        return False, None
    return True, result[1]

def cleanup_child_process_group(child_pid, child_reaped, child_status):
    """Bounded TERM/KILL cleanup for the PTY leader and all descendants."""
    if not child_reaped:
        child_reaped, status = poll_child(child_pid)
        if status is not None:
            child_status = status
    if child_reaped and not child_process_group_exists(child_pid):
        return child_reaped, child_status

    signal_child_process_group(
        child_pid,
        signal.SIGTERM,
        allow_pid_fallback=not child_reaped,
    )
    deadline = time.monotonic() + PROCESS_GROUP_TERM_GRACE_SECONDS
    while time.monotonic() < deadline:
        if not child_reaped:
            child_reaped, status = poll_child(child_pid)
            if status is not None:
                child_status = status
        if child_reaped and not child_process_group_exists(child_pid):
            return child_reaped, child_status
        time.sleep(0.02)

    signal_child_process_group(
        child_pid,
        signal.SIGKILL,
        allow_pid_fallback=not child_reaped,
    )
    deadline = time.monotonic() + PROCESS_GROUP_KILL_GRACE_SECONDS
    while time.monotonic() < deadline:
        if not child_reaped:
            child_reaped, status = poll_child(child_pid)
            if status is not None:
                child_status = status
        if child_reaped and not child_process_group_exists(child_pid):
            break
        time.sleep(0.02)

    if not child_reaped:
        child_reaped, status = poll_child(child_pid)
        if status is not None:
            child_status = status
    return child_reaped, child_status

def process_control_data(buffer, data, master_fd, child_pid):
    buffer += data
    while b'\n' in buffer:
        raw_line, buffer = buffer.split(b'\n', 1)
        parts = raw_line.decode('ascii', errors='replace').strip().split()
        try:
            if len(parts) == 3 and parts[0] == 'resize':
                cols = int(parts[1])
                rows = int(parts[2])
                if not (1 <= cols <= MAX_TERMINAL_DIMENSION):
                    raise ValueError
                if not (1 <= rows <= MAX_TERMINAL_DIMENSION):
                    raise ValueError
                apply_resize(master_fd, cols, rows)
            elif len(parts) == 2 and parts[0] == 'signal':
                signum = CONTROL_SIGNALS.get(parts[1])
                if signum is None:
                    raise ValueError
                signal_child_process_group(child_pid, signum)
            else:
                raise ValueError
        except (ValueError, OSError) as exc:
            detail = f": {exc}" if str(exc) else ""
            print(
                f"pty-helper: ignoring invalid control command{detail}",
                file=sys.stderr,
                flush=True,
            )

    # Bound an unterminated or otherwise malformed frame.
    if len(buffer) > 8192:
        print(
            "pty-helper: ignoring oversized control command",
            file=sys.stderr,
            flush=True,
        )
        return b''
    return buffer

def main():
    if len(sys.argv) < 2:
        print("Usage: pty-helper.py [--cwd PATH] -- <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cwd, cmd = parse_args(sys.argv[1:])
    control_fd = available_control_fd()
    original_parent_pid = os.getppid()

    # Fork with a PTY
    pid, master_fd = pty.fork()

    if pid == 0:
        # Child: exec the command
        if control_fd is not None:
            try:
                os.close(control_fd)
            except OSError:
                pass

        if cwd:
            try:
                os.chdir(cwd)
            except OSError as exc:
                print(f"pty-helper: unable to chdir to {cwd}: {exc}", file=sys.stderr)
                sys.exit(1)
            os.environ['PWD'] = cwd

        # Set terminal size from env if available
        try:
            cols = int(os.environ.get('COLUMNS', '80'))
            rows = int(os.environ.get('LINES', '24'))
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

        os.execvp(cmd[0], cmd)
        # If exec fails
        sys.exit(127)

    # Parent: proxy I/O between stdin/stdout and the PTY master
    def forward_signal(signum, frame):
        signal_child_process_group(pid, signum)

    def force_kill_child_group(signum, frame):
        signal_child_process_group(pid, signal.SIGKILL)

    signal.signal(signal.SIGINT, forward_signal)
    signal.signal(signal.SIGTERM, forward_signal)
    signal.signal(signal.SIGUSR1, force_kill_child_group)

    # Make stdin non-blocking
    stdin_fd = None
    try:
        stdin_fd = sys.stdin.fileno()
        flags = fcntl.fcntl(stdin_fd, fcntl.F_GETFL)
        fcntl.fcntl(stdin_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    except Exception:
        pass

    control_buffer = b''
    child_reaped = False
    child_status = None
    try:
        while True:
            # Reparenting is the reliable cross-platform signal that the Node
            # owner disappeared. It may be PID 1 or a subreaper on Linux.
            if os.getppid() != original_parent_pid:
                break

            try:
                fds = [master_fd]
                if stdin_fd is not None and not sys.stdin.closed:
                    fds.append(stdin_fd)
                if control_fd is not None:
                    fds.append(control_fd)

                rlist, _, _ = select.select(fds, [], [], 0.1)
            except select.error:
                break

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 4096)
                    if not data:
                        break
                    os.write(sys.stdout.fileno(), data)
                    sys.stdout.flush()
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    raise

            if stdin_fd is not None and stdin_fd in rlist:
                try:
                    data = os.read(stdin_fd, 4096)
                    if not data:
                        # EOF on stdin — close PTY input
                        os.close(master_fd)
                        break
                    os.write(master_fd, data)
                except OSError as e:
                    if e.errno in (errno.EIO, errno.EBADF):
                        break
                    raise

            if control_fd is not None and control_fd in rlist:
                try:
                    data = os.read(control_fd, 4096)
                    if not data:
                        os.close(control_fd)
                        control_fd = None
                    else:
                        control_buffer = process_control_data(
                            control_buffer,
                            data,
                            master_fd,
                            pid,
                        )
                except OSError as exc:
                    if exc.errno not in (errno.EIO, errno.EBADF):
                        print(
                            f"pty-helper: resize control error: {exc}",
                            file=sys.stderr,
                            flush=True,
                        )
                    control_fd = None

            # Check if child is still alive
            try:
                result = os.waitpid(pid, os.WNOHANG)
                if result[0] != 0:
                    child_reaped = True
                    child_status = result[1]
                    # Child exited, drain remaining output
                    while True:
                        try:
                            rlist, _, _ = select.select([master_fd], [], [], 0.1)
                            if not rlist:
                                break
                            data = os.read(master_fd, 4096)
                            if not data:
                                break
                            os.write(sys.stdout.fileno(), data)
                        except OSError:
                            break
                    break
            except ChildProcessError:
                child_reaped = True
                break

    except Exception:
        pass
    finally:
        child_reaped, child_status = cleanup_child_process_group(
            pid,
            child_reaped,
            child_status,
        )
        if control_fd is not None:
            try:
                os.close(control_fd)
            except Exception:
                pass
        try:
            os.close(master_fd)
        except Exception:
            pass

    if child_status is None:
        return 0 if child_reaped else 1
    return os.WEXITSTATUS(child_status) if os.WIFEXITED(child_status) else 1

if __name__ == '__main__':
    sys.exit(main())
