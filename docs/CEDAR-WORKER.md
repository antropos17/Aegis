# Dormant Cedar worker adapter

Status: reviewed preparation code. No production caller uses this adapter.
The existing synchronous route in `prepareExecution` is unchanged. The
[Cedar policy contract](ACTION-POLICY-CEDAR.md) remains authoritative.

`createCedarWorkerClient()` owns one disposable worker at a time.
`evaluate(policy, action, {timeoutMs, signal})` returns closed decision metadata;
there is no queue or synchronous fallback. The default timeout is 5000 ms,
with accepted integer values from 1 through 30000 ms. Its deadline covers
startup, package loading, compilation, evaluation and clean exit. A candidate
reply is delivered only after exit confirms success.

Timeout, cancellation or error can return denial while termination is pending.
New requests remain refused until exit is confirmed. `close()` permanently
closes admission and requests termination; its return is not a cleanup receipt.
The caller owns control options, the AbortSignal and any constructor test seam.
The parent JavaScript event loop must remain responsive; this is not an external
hard-kill supervisor.

Policy/action messages use bounded descriptor-based copies. Proxies are refused
before inspection and dense-array lengths are captured once before iteration.
Effective cached Node Worker diagnostics cause refusal before private copying
or construction. An empty child environment cannot suppress the parent's debug
log. Replies contain validated decision metadata, never private request paths
or raw exceptions.

R2 validation passed 35 focused tests, both modules' `@ts-check` body checks,
scoped lint/format and two assertion mutations. A final-source fixture loaded
official Cedar 4.13.0 WASM from ASAR under Electron 44.7.2 embedded Node 24.21.0,
verified allow/forbid and missing-WASM denial, and confirmed exits. This qualifies
that fixture's loading and lifetime behavior, not the actual product caller.

Worker threads share process memory. V8 limits do not contain WASM, ArrayBuffer
or other external memory, or prevent process OOM. Activation requires the parent
policy change to be approved, actual caller/runtime qualification and a fresh
binding check after the asynchronous wait. Full W5 and guard readiness remain
open.
