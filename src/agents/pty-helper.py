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

def main():
    if len(sys.argv) < 2:
        print("Usage: pty-helper.py [--cwd PATH] -- <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cwd, cmd = parse_args(sys.argv[1:])

    # Fork with a PTY
    pid, master_fd = pty.fork()

    if pid == 0:
        # Child: exec the command
        if cwd:
            try:
                os.chdir(cwd)
            except OSError as exc:
                print(f"pty-helper: unable to chdir to {cwd}: {exc}", file=sys.stderr)
                sys.exit(1)
            os.environ['PWD'] = cwd

        # Set terminal size from env if available
        try:
            import fcntl
            import struct
            import termios
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
    try:
        import fcntl
        flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
        fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, flags | os.O_NONBLOCK)
    except Exception:
        pass

    try:
        while True:
            # Check if parent is still alive. If parent dies, ppid becomes 1 (init/systemd)
            if os.getppid() == 1:
                break

            try:
                fds = [master_fd]
                try:
                    # Check if stdin is still readable/connected
                    if not sys.stdin.closed:
                        fds.append(sys.stdin.fileno())
                except Exception:
                    pass

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

            if sys.stdin.fileno() in rlist:
                try:
                    data = os.read(sys.stdin.fileno(), 4096)
                    if not data:
                        # EOF on stdin — close PTY input
                        os.close(master_fd)
                        break
                    os.write(master_fd, data)
                except OSError as e:
                    if e.errno in (errno.EIO, errno.EBADF):
                        break
                    raise

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
