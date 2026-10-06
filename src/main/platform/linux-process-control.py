"""Check a process generation and signal only the pinned Linux pidfd."""
import errno
import os
import re
import signal
import sys


def main():
    if len(sys.argv) != 4:
        return 2
    pid_text, expected, action = sys.argv[1:]
    if not re.fullmatch(r"[1-9][0-9]{0,9}", pid_text):
        return 2
    pid = int(pid_text)
    if pid > 2147483647 or not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}:[0-9]{1,40}", expected
    ):
        return 2
    signals = {"kill": signal.SIGKILL, "suspend": signal.SIGSTOP, "resume": signal.SIGCONT}
    if action not in signals:
        return 2
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        return 4
    fd = None
    try:
        # Pin first: an exit/reuse during validation cannot retarget this handle.
        fd = os.pidfd_open(pid, 0)
        with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as stream:
            boot = stream.read(128).strip().lower()
        with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as stream:
            stat = stream.read(8192)
        close = stat.rfind(")")
        fields = stat[close + 1:].split()
        if close < 0 or len(fields) < 20 or not fields[19].isdigit():
            return 3
        if f"{boot}:{fields[19]}" != expected.lower():
            return 3
        signal.pidfd_send_signal(fd, signals[action], None, 0)
        return 0
    except OSError as error:
        if error.errno in (errno.ESRCH, errno.ENOENT):
            return 3
        if error.errno in (errno.ENOSYS, errno.EINVAL):
            return 4
        return 5
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == "__main__":
    sys.exit(main())
