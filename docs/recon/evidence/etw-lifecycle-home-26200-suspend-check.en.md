# English translation of captured sleep-state diagnostics

This translates `powerContext.report.availableStatesAtCapture` in
[the original suspend-check evidence](etw-lifecycle-home-26200-suspend-check.json).
The JSON retains the Russian output captured from Windows. This document is a
translation of that capture, not a new command result or a live sleep test.

## Available sleep states

- Standby (S0 Low Power Idle), network connected.

## Unavailable sleep states and reported reasons

| State | Reported reasons |
| --- | --- |
| Standby (S1) | System firmware does not support this standby state. This standby state is disabled when S0 low-power idle is supported. |
| Standby (S2) | System firmware does not support this standby state. This standby state is disabled when S0 low-power idle is supported. |
| Standby (S3) | This standby state is disabled when S0 low-power idle is supported. |
| Hibernation | Hibernation has not been enabled. |
| Hybrid sleep | Standby (S3) and hibernation are unavailable. The hypervisor does not support this standby state. |
| Fast startup | Hibernation is unavailable. |

These are the host's advertised capabilities at capture time. They do not establish
that an actual suspend/resume cycle passed; real sleep testing was deferred.
