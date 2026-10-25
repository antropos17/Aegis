# Bounded own-Node resource observations

Status: instrumentation preparation only. This opt-in library samples the calling
Node process. It has no runtime integration, CLI, persistence, host discovery,
arbitrary PID input, subprocesses, native collector, Electron dependency or event
capture. It supplies no product/cohort footprint, calibrated overhead,
reproducibility or W8/T8 acceptance. The remaining protocol is in
[METHOD.md](../docs/bench/METHOD.md#future-resource-capture-and-repetitions).

```js
const { sampleSelfResources } = require('./lib/self-resource-sampler');
const raw = await sampleSelfResources({ runId: 'instrumentation-1', durationMs: 4000 });
// Persistence, immutable source hashes and receipt storage belong to the caller.
```

The returned `self-resource-samples/1` object is a distinct raw format. It cannot
be passed to [resource interval arithmetic](RESOURCE_INTERVALS.md): CPU and RSS
have independent acquisition brackets. `actualUs` is the scheduler's observation
before acquisition; it is no assertion that counters or memory were captured at
that instant. No midpoint, common timestamp, aligned interval, OS birth time or
lifecycle identity is invented. CPU percentages, group totals, phase estimates
and percentiles are absent. `identity.osBirthTime` and `population.complete` are
explicitly `null` with reasons.

Use [acquisition-window intervals](BRACKETED_RESOURCE_INTERVALS.md) to derive
conditional own-process CPU bounds and RSS phase admission from these raw readings.

The optional [retained session](../docs/bench/SELF_RESOURCE_SESSION.md) supplies a
fresh bounded bundle and explicit plan around this unchanged library. It retains
calling-process scope and adds no product or measurement acceptance.

## APIs, time and raw values

Default collection calls [`process.cpuUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processcpuusagepreviousvalue)
without a previous reading, retaining cumulative `user` and `system` CPU counters
in microseconds. [`process.memoryUsage.rss()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusagerss)
provides current process RSS in bytes. Its recorded definition is
`node-process-rss`; a future platform collector must qualify native definitions
and comparisons. Shared pages may be double counted in process comparisons or
sums. `process.resourceUsage().maxRSS` is not used.

[`process.hrtime.bigint()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processhrtimebigint)
provides nanoseconds in an arbitrary monotonic domain. The initial successful
reading is the collector's relative origin, without claiming process birth or a
wall-clock epoch. Subtract in bigint before flooring to integer microseconds;
check ordering in nanoseconds before quantization. This reports representation
precision, without claiming measured clock accuracy or resolution. Each CPU and
RSS observation retains its own `beforeUs` and `afterUs`. Ordering or clock
availability failures remain explicit; raw numeric counters may still survive a
failed ending bracket, accompanied by its reason.
`clock.lastObservedUs` retains the last successful clock observation, including
an out-of-window wake or overrun; it is `null` if no clock was observed.

Values must be finite nonnegative safe integers. Missing/throwing APIs and
invalid readings yield `null` with closed reasons, never a substituted zero.
Actual numeric zero remains zero. CPU counters are retained verbatim, including
regressions; this raw collector does not perform interval admission. Error
messages and arbitrary reader objects are never copied into the result.

## Schedule and bounds

Options are a closed ordinary object. `runId` is required: 1–64 ASCII letters,
digits, dots, underscores or hyphens, beginning with a letter or digit. Unknown
keys, symbols, accessors and nonordinary prototypes are rejected with
`self-resource-input-invalid`.

| Option | Bound |
| --- | --- |
| `durationMs` | Default 4000; 1000–60000 in whole 1000 ms steps |
| `maxSamples` | Default 60; integer 1–60 |
| `maxOutputBytes` | Default 131072; integer 2048–131072 serialized UTF-8 bytes |
| `signal` | Optional Node `AbortSignal` |

Cadence is exactly 1000000 microseconds. The planned grid is start-inclusive and
end-exclusive: a 4000 ms plan has points at 0, 1, 2 and 3 seconds. A successful
ordinary run finishes after acquiring the last point; it does not wait out an
unused final second. Timers are scheduled relative to the monotonic origin.
Early wakes recheck the clock. At most 240 timer requests are allowed, bounding
even an injected scheduler that never advances time.

A late wake skips earlier overdue grid points, records each as `scheduler-late`,
and acquires only the newest due point. `latenessUs` retains its observed delay.
There is no loop replaying skipped acquisitions or a catchup burst. A slow
synchronous reader can similarly leave skipped points on the next iteration.

Each reader checks admission at its own starting bracket. CPU or RSS whose
`beforeUs` reaches the excluded duration endpoint is skipped with null values and
`reason:'duration-limit'`, including when time advanced after the scheduler check
or while the previous reader ran. A reader already running can reach or cross
that boundary: its raw values and bracket remain recorded and the run stops
with `duration-limit`. Ending exactly at the endpoint also prevents completion.
Cancellation and timers cannot preempt synchronous native
work or a blocked JavaScript event loop. These are finite schedule/acquisition
limits, rather than an external hard-kill mechanism; callers requiring a strict
wall deadline must supply an external supervisor. Timer delivery itself has no
exact timing guarantee.

`missed` retains skipped interior points. `unattempted` compactly records the
first remaining scheduled point, remaining count and terminal reason for sample,
duration, output, clock, scheduler or cancellation stops. This preserves the
planned tail without manufacturing observations. `stopReason:null` means the
schedule ended ordinarily; `complete` additionally requires no missed points and
valid brackets/readings for every acquired point. It describes this bounded
instrumentation schedule alone, without product or population completeness.

Output accounting reserves 512 bytes for terminal metadata and checks before
retaining each sample/missed point. A conservative `output-limit` stop may occur
before the exact byte cap. A final serialized-size check refuses any overflow
with `self-resource-output-too-large`. All dynamic result content is numeric or
a validated run ID; other strings are fixed schema/API/reason labels. The
collector reads no environment, command line, filenames, user data or host
process catalog. The caller owns storage quotas, retention and source hashes.

## Cancellation, injection and verification

Cancellation before collection accesses no clock/readers. Cancellation while
waiting removes the abort listener and clears the owned timer. An injected
`clearTimer` failure is reported as `pendingTimer:true` and
`cleanupReason:'timer-cancel-unavailable'`; cleanup is not falsely confirmed.
If an injected scheduler throws before returning a handle, `pendingTimer:null`
and `timer-state-unavailable` retain the unknown state of any work it may have
started. The sampler cannot cancel work whose handle was never returned.
Cancellation is rechecked between synchronous readers. There are no asynchronous
reader jobs to terminate, and `inFlightReading:false` describes the returned
state, not an ability to interrupt an active synchronous operation.

The optional second argument is a closed test seam: synchronous `nowNs`,
`cpuUsage`, `rss`, `setTimer` and `clearTimer` functions, or explicit `null` for
unavailable dependencies. Reader promises are unsupported and refused as invalid
readings; the caller remains responsible for any work it started inside an
injected function. Any injection marks the receipt `readingMode:'injected'`.
The recorded API names then identify the production adapter contract, without
authenticating the injected values as native observations. Timer handles and
dependency values are never published.

`tests/main/bench/self-resource-sampler.test.js` uses deterministic injected
readings and timers. It checks actual API selection through spies, separate
brackets, missing evidence/zero distinctions, clock ordering/precision, late and
missed points, finite bounds, cancellation and truthful cleanup. These fixtures
establish library behavior. A short real own-Node smoke establishes only that
the instrumentation executes on that tested Node/OS combination; it does not
qualify AEGIS, native capture, baseline equivalence, overhead or acceptance.
