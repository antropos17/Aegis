---
name: testing
description: Design or update meaningful AEGIS Vitest tests, including CommonJS dependency seams, renderer tests and Svelte component environments.
---

# AEGIS tests

Read vitest.config.js and nearby tests before choosing a location, extension or environment. Current projects separate main/shared Node tests, renderer logic tests, and Svelte component tests in jsdom. Main/shared patterns currently include .test.js; renderer/component patterns also accept .test.ts. Follow the configured project instead of requiring every new test to be JavaScript.

## Loading and mocking

Test files use ESM Vitest imports. Import renderer TypeScript/ESM through Vite. For CommonJS subjects that must share Node's module cache with require() callers, use createRequire(import.meta.url); see tests/main/anomaly-detector.test.js and tests/shared/instance-key.test.js.

vi.mock controls transformed imports and does not intercept native CommonJS require calls. Use the subject's existing dependency-injection seams for main/platform dependencies. When native cache control is necessary, follow a nearby harness and restore affected entries; do not mix separate module instances and assume the mock reached the production caller. Restore mocks, timers and state between tests.

## Running and scope

If the checkout provides `dev:context`, use its module inventory to locate direct test imports and effective typecheck scope. Confirm test selection against the actual callers: no direct import match means unknown, not untested. `coverage.include` is instrumentation scope and does not establish execution or assertions. In JS, inspect `checkJs` and per-file `@ts-check`/`@ts-nocheck`; a successful solution-file `tsc` invocation may check nothing.

During iteration, run affected behavioral tests first. Before merging, complete the current required gates once for the final inputs; repeat when changed inputs, failures or unresolved risks warrant it. Native Windows/Electron paths need matching runtime evidence. For Observatory use the active `frontend:test:electron` harness when the change warrants it; historical demo screenshot scripts do not exercise the production bridge.

For resource-sensitive native setup failures, preserve the initial result and run the failing suite in isolation before repeating a full batch. A reduced-worker run can distinguish load sensitivity; record the worker count and do not call a passing retry a proven fix. Keep temporary/cache output on the spacious drive and measure storage around heavy runs. Documentation or instruction edits need relevant structural checks; reuse runtime evidence only for unchanged relevant inputs, while still requiring the current PR's CI contexts.

- npm test runs the full configured suite.
- npx vitest run <test-file> runs a focused file.
- npx vitest run <test-file> --reporter=verbose adds details without entering watch mode.
- npm run test:coverage and the verification gates follow the repository's current CI requirements.

Test observable contracts, failure paths and regressions warranted by the change. Do not add tests that mirror a reversible low-impact implementation edit. Use disposable fixtures and existing seams; run temporary-source mutation gates separately from checks that scan the source tree. Report counts and results from the actual run, with skipped or unavailable coverage explicit.
