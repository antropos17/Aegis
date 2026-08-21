/**
 * @file bench/trace/preload.js
 * @module bench/trace/preload
 * @description The `--require` entrypoint that puts the virtual clock and the recorded
 *   time zone in front of the real ones, before any other module is compiled.
 *
 *   ```
 *   AEGIS_TRACE_CLOCK_EPOCH_MS=1755766432000 AEGIS_TRACE_TZ=Etc/UTC \
 *     node --require bench/trace/preload.js bench/trace/replay-trace.js <trace dir>
 *   ```
 *
 *   WHY A PRELOAD AND NOT AN INJECTION POINT. Every other seam this harness uses is one
 *   the product already exports — `init(state)`, `_setDepsForTest`, `reloadRules(dir)`.
 *   The clock is the one thing no seam covers: `src/main/audit-logger.js` stamps
 *   `new Date().toISOString()` on every record it writes, and `src/main/baselines.js`
 *   reads `new Date().getHours()`. Both are globals, and a global has to move before the
 *   module that closes over it is compiled. `--require` is the mechanism Node provides
 *   for exactly that. Nothing in `src/` is patched.
 *
 *   THIS FILE ACTS ON LOAD, and that is its whole job. It is deliberately the only
 *   thing here: everything that can be asked a question instead of doing something
 *   lives in `./clock-env.js`, so a suite can exercise the decisions without a process
 *   acquiring a virtual clock merely because a test imported a file.
 *
 *   A THROW IS THE INTENDED FAILURE MODE. It is not caught: Node reports it and exits
 *   non-zero before the entrypoint gets a chance to produce a verdict on the wrong
 *   clock. `tests/shared/bench-trace/clock.test.js` spawns this both ways — with the
 *   flag and without it — because a preload that silently declined to install looks
 *   exactly like one that worked, right up until the verdict cannot be reproduced.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

require('./clock-env').bootstrap();
