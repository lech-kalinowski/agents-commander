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

CONTROL_FD = 3
MAX_TERMINAL_DIMENSION = 10000

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

def process_control_data(buffer, data, master_fd):
    buffer += data
    while b'\n' in buffer:
        raw_line, buffer = buffer.split(b'\n', 1)
        parts = raw_line.decode('ascii', errors='replace').strip().split()
        try:
            if len(parts) != 3 or parts[0] != 'resize':
                raise ValueError
            cols = int(parts[1])
            rows = int(parts[2])
            if not (1 <= cols <= MAX_TERMINAL_DIMENSION):
                raise ValueError
            if not (1 <= rows <= MAX_TERMINAL_DIMENSION):
                raise ValueError
            apply_resize(master_fd, cols, rows)
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
        try:
            os.kill(pid, signum)
        except OSError:
            pass

    signal.signal(signal.SIGINT, forward_signal)
    signal.signal(signal.SIGTERM, forward_signal)

    # Make stdin non-blocking
    stdin_fd = None
    try:
        stdin_fd = sys.stdin.fileno()
        flags = fcntl.fcntl(stdin_fd, fcntl.F_GETFL)
        fcntl.fcntl(stdin_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    except Exception:
        pass

    control_buffer = b''
    try:
        while True:
            # Check if parent is still alive. If parent dies, ppid becomes 1 (init/systemd)
            if os.getppid() == 1:
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
                    sys.exit(os.WEXITSTATUS(result[1]) if os.WIFEXITED(result[1]) else 1)
            except ChildProcessError:
                break

    except Exception:
        pass
    finally:
        if control_fd is not None:
            try:
                os.close(control_fd)
            except Exception:
                pass
        try:
            os.close(master_fd)
        except Exception:
            pass

    # Wait for child
    try:
        _, status = os.waitpid(pid, 0)
        sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
    except ChildProcessError:
        sys.exit(0)

if __name__ == '__main__':
    main()
