# W1a JavaScript preparation

This slice prepares `sensor/1` after merged W1-pipe, from master `dbeb5edc`.
It preserves raw process birth and composite generation witnesses, shares the
existing Linux reader's host-owned D1 conversion, and adds a pure JavaScript
codec with independent binary/JSON fixtures. The detailed API, field vocabulary
and finite limits are in [sensor-wire.md](sensor-wire.md).

The codec validates both directions, rejects unknown fields, enforces exact
integer spellings and terminal framing errors, and copies approved data before
encoding or delivery. Direct JavaScript records, options and arrays are admitted
through own data descriptors; getters, proxies and overridden array methods
cannot supply unvalidated values. Callback delivery is synchronous. Promise
returns fail terminally; observing their rejection has the explicit best-effort
boundary documented in the contract.

The Linux reader exposes a fresh frozen birth context after a verified healthy
pass, withdraws it on failure and retains the same-boot anchor internally for
recovery. Neither helper reconstructs raw birth from epoch milliseconds or
cached per-PID observations. Existing session IDs and platform/control
capability allowlists are unchanged.

## Verification

Qualified Node 24.20.0 passed **265 focused tests in 10 files** on Windows before
the last two-file correction. They cover the codec, identity helpers, Linux
reader/races/adapter and retained process-snapshot decoder. Scoped lint, main
TypeScript and formatting passed on that revision. The final correction passed
**94 tests in two files**, scoped lint/formatting and a private-copy control.
The final frozen manifest records 53 source/test/fixture/contract inputs.

Independent review found a quadratic key-membership scan before closed-schema
rejection. A bounded public-entry regression reproduced 33,670 comparisons on
259 keys against a 518-operation budget. Set membership fixes it; the unchanged
private control passed, and restoring the old scan caused an assertion failure.
This uses an operation count without timing or a large hostile frame.

The author detected **16 of 16 correction mutants** with actual assertion
failures in private copies; the unchanged control passed 204 tests in six files.
Separate RED/GREEN receipts cover the later proxied-Buffer guard, included in
the final 265 tests. Its optional additional mutant was omitted after the
coordinator stopped further local batches at the disk-space boundary.

Earlier revision controls retain 28 detected protocol mutants and 11 detected
identity mutants. Two identity controls fail through unexpected fixed exceptions
on valid inputs. These are prior-revision evidence: the full mutation batches
were not repeated after the reviewed admission/Promise changes. Changed groups
have the new correction controls. No shared source was mutated by those gates.

The tests execute the real pure modules and the actual Linux reader/adapter
dependency seam with synthetic OS input. All **27 binary goldens** are generated
from literal JSON by a script that never imports the production encoder.
Independent security, correctness and test-quality reviews accepted the final
frozen implementation after inspecting the receipts and source hashes. Those
reviews were read-only; they did not execute the writer's controls again.
TypeScript configuration retains `checkJs:false`, so its successful gate does
not prove JavaScript body typing.

Full repository gates run on the final PR revision in hosted CI. This pre-merge
report does not assert their result; the PR and external completion tracker
record the exact head and all five required contexts before acceptance.

## Acceptance boundary

This document qualifies the JavaScript preparation slice. The owner subsequently
authorized Rust setup; Rust 1.99.1 MSVC is installed on X. The Rust workspace and
codec merged in #996 after owner confirmation. Both-language golden gates and
exact PR/master checks passed, completing the scoped W1a wire prerequisite. W1b's host/session state, custody, active
capability enforcement and cross-frame continuity remain separate work.
No live Linux/macOS provider, eBPF/procfs parity, complete Electron application,
installer or production acceptance is established by these fixtures.

The original dirty checkout is preserved. Diagnostics stay finite on X:, with
per-command deadlines/output caps and manual retention review; receipts remain
available. C: free space transiently fell below 2 GiB. One final read/check batch
started before that reading was inspected; the author disclosed the sequencing
error and subsequent batches were stopped. The source of the transient C:
allocation remains unconfirmed; no cleanup, service or global setting change
was used. Hosted CI supplies the full repository gates.

Identity/wire changes also require the owner's confirmation after independent
review under [the merge policy](completion-plan.md#54-merging).
