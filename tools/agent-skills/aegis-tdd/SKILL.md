---
name: aegis-tdd
description: Implement meaningful AEGIS features or regressions with one failing behavioral test and minimal implementation at a time. Use for TDD or test-first fixes; the existing testing skill owns Vitest harness details.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/SKILL.md
---

# AEGIS test-driven changes

Adapted from Matt Pocock's tdd skill; attribution and terms: [LICENSE](LICENSE).

## Choose a contract already grounded in the project

Read the active checkout's AGENTS.md, current source and nearby tests. Use [aegis-context](../aegis-context/SKILL.md) for navigation and [testing](../testing/SKILL.md) for test harness conventions when available. If a worktree lacks these ignored local skills, read the checkout's package.json, Vite and Vitest configurations directly. Never choose a renderer directory from an old handoff alone.

Translate the user's request or existing documented invariant into an observable expectation. Choose the public boundary already used by the code, state it briefly, and proceed. No repeated approval is needed for an ordinary authorized test/fix. Ask only when unresolved expected behavior materially changes the implementation. Preserve concurrent work and do not delegate unless the user requests it.

## Put the test where the bug occurs

For main-process CommonJS code, native require needs the existing dependency seams/cache pattern; vi.mock alone is insufficient. Reuse init(deps), _setDepsForTest() and _resetForTest() where supported, and restore timers, mocks and shared state. For renderer tests, use the active Vitest project and its configured jsdom/Svelte environment. Match file extensions to the actual test include patterns.

The test boundary must reach the production caller and observe its output. Examples to select only when the change concerns them:

- Same PID reused by another process, or simultaneous same-named agents: observations remain attached to the correct instance.
- Observation outage followed by recovery: existing sessions are not falsely ended or split.
- Unknown ownership: no unrelated agent receives the event as a fallback.
- Audit overflow or unwritable storage: persisted-chain validity and loss visibility remain separate facts.
- IPC or renderer updates: the active consumer receives and displays the intended state; malformed or missing input follows its documented contract.

Read the relevant failure history in memory-bank/ai-mistakes.md. These examples identify test subjects; expected values come from the current request and code contracts, not a new policy invented by this skill.

## Red, green, then the next behavior

1. Write one meaningful behavioral test with an independent expected result. Run it with `npx vitest run <test-file>` and confirm it fails because of the intended behavior. A startup/import failure is not evidence that the regression is covered.
2. Implement the smallest change to satisfy that test. Avoid speculative APIs and bulk tests for imagined behavior.
3. Run the focused file and relevant neighbors. Small cleanup is allowed with tests green; architecture work requires its own task scope.

Use public behavior rather than private method calls, duplicated formulas or mocks that reproduce the implementation. Do not write tests for reversible low-impact edits that merely check wording or formatting. Existing tests can be extended instead of creating a parallel harness.

For a critical regression, a targeted mutation can demonstrate that the assertion detects the fault. Restore only the temporary change you made, preserve unrelated edits, and run source-mutating gates in isolation from other readers. Do not invent a mutation gate for every edit.

## Honest completion

Follow the current verification requirements in AGENTS.md and CI. Check that the modified module is included in the applicable test/coverage project; a green suite that omits it is not coverage. Use npm run typecheck for configured projects and npm run typecheck:svelte for template checks. Root tsc --noEmit alone is insufficient.

State which behavior failed before, passed after and remains untested. Native/ETW tests need their own documented harness and authorization where applicable; synthetic and normal-token tests do not establish live-provider, elevation, sleep/wake or loss-free operation. Do not change tests, coverage thresholds or protected configuration merely to turn unrelated failures green.
