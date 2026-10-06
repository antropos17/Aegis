# Linux process control

Process actions require `/usr/bin/python3` 3.9+ and a kernel supporting
`pidfd_open` and `pidfd_send_signal`. The fixed Python helper runs in isolated
mode, without third-party packages. Process monitoring continues through the
existing procfs provider. Missing control support produces an explicit error.

Linux packages copy the helper to the resources directory with `extraResources`.
Packaged Electron resolves that physical file; external Python cannot read a
script stored only inside `app.asar`. Development resolves the source file.

The owned IPC handler checks the current observation and forwards its Linux
generation witness (boot identity and kernel start ticks). The helper opens a
pidfd, reads the current procfs witness, compares it with the observation, and
sends the fixed signal through that same descriptor. The descriptor is closed
on success and failure. There is no fallback signal against a bare PID.

The runner bounds helper execution to five seconds and 4096 output bytes.
Errors returned to the renderer are fixed messages; raw helper diagnostics,
process names and exception details are not returned.

## Verification

Run the committed regression tests with Node 24 on Linux:

```sh
npx vitest run tests/main/platform/linux-process-control.test.js \
  tests/main/platform/linux-process-map.test.js \
  tests/main/platform/linux-process-map-races.test.js \
  tests/main/ipc-handlers.test.js
```

The native test creates a disposable child, rejects a changed start-tick witness
without killing it, observes SIGSTOP and SIGCONT states, and then terminates
the same child. It skips when Python or pidfd APIs are unavailable; that skip
does not qualify native process control. Unit tests also cover rejected input,
timeout, missing helper support and fixed error messages.

On 2026-10-06, an independent native probe in Ubuntu under WSL2 passed with
Node 24.18.1, Python 3.14.4 and kernel 6.6.87.2. The pre-fix probe failed because
the stale witness was ignored. This evidence qualifies the tested Linux kernel
path; it does not qualify a standalone Linux desktop build, macOS, or every
kernel/distribution. Forced reuse of an actual kernel PID was not performed.

API contracts: [Python pidfd_open](https://docs.python.org/3/library/os.html#os.pidfd_open),
[Python pidfd_send_signal](https://docs.python.org/3/library/signal.html#signal.pidfd_send_signal),
[Linux pidfd_send_signal](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html).
