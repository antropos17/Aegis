---
name: aegis-diagnosing-bugs
description: Diagnose AEGIS process attribution, sensor, audit, IPC, renderer or performance regressions using a repeatable failure signal. Use for reported bugs; excludes broad architecture audits and feature planning.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/diagnosing-bugs/SKILL.md
---

# AEGIS bug diagnosis

Adapted from Matt Pocock's diagnosing-bugs skill; attribution and terms: [LICENSE](LICENSE).

## Locate the running path

Read the active checkout's AGENTS.md, package.json, relevant memory-bank/progress.md entries and affected source. Use [aegis-context](../aegis-context/SKILL.md) for source navigation when available; a worktree without that local skill can use the same root documents directly. Record HEAD, git status and the actual renderer entrypoint from Vite configuration. The skill's installation folder does not select the checkout or running app.

Read relevant memory-bank/ai-mistakes.md entries for identity, audit-chain or Windows worktree changes. Check historical notes against current code rather than reopening work already completed.

Explicit user instructions and existing project authorization govern the task. Continue ordinary authorized diagnosis and fixes without a new plan gate. Do not spawn agents or external AI CLIs unless the user requests delegation. Preserve concurrent work and project restrictions on protected configuration, release actions and lockfiles.

## Reproduce before committing to a cause

Describe the exact observed failure and expected behavior. Build a short pass/fail loop through the real failing path: a focused Vitest test, integration harness, Electron/renderer scenario, sidecar self-test or captured-event replay. Read nearby tests and current vitest.config.js. The existing [testing](../testing/SKILL.md) explains harness details; consult it when available.

For CommonJS main modules, vi.mock does not intercept native require calls. Reuse init(deps), _setDepsForTest() and _resetForTest() as supported by the subject. Match the nearby createRequire/cache pattern and restore state. Prove the production caller consumed the controlled dependency; a detached module instance can make a convincing but irrelevant test.

Run the reproduction and capture the actual failure. For an intermittent symptom use bounded runs and record incidence. For a performance regression compare the same workload, executable/configuration, observation window and environment. Pin time or input order when appropriate without masking the race being investigated.

If reproduction is unavailable, continue useful read-only tracing, list what is unverified and obtain the minimum missing evidence. Do not block all investigation merely because a deterministic harness is impossible. A hypothesis is not a proven cause.

## Follow the affected contract

- Identity: trace the OS observation through the stamped instance key and its consumers. Test process reuse or concurrent same-named instances when relevant. Unknown birth time remains null; a scan outage does not become a confirmed empty process population.
- Sensor/event health: preserve distinctions among no activity, failed observation, deliberate filtering and counted loss. A successful helper call alone does not prove complete event coverage.
- Audit: trace the actual append/flush/normalization path and the failure mode. A valid retained hash chain does not prove that no events were dropped before persistence.
- IPC/UI: verify the actual main-to-preload-to-active-renderer path. A formatter or store test alone cannot prove that the visible UI uses the result.
- ETW/native sidecars: inspect the affected sidecar's README and current roadmap before choosing the harness. Separate synthetic/self-test, normal-token process and live-provider evidence. Live elevation, sleep/wake or protected-machine actions require the applicable user authorization. Never infer live correctness or complete transport from a passing mock. Do not change machine security settings to make a test run.

For complex failures, rank a small set of falsifiable hypotheses, test one variable at a time and narrow the reproduction. Avoid a mandatory hypothesis count for an obvious failure. Temporary logs must be identifiable and redact credentials and private monitored content.

## Fix and verify

Where a meaningful test boundary exists, add a regression test before the minimal fix. Exercise the actual triggering pattern, including multiple callers when needed. Re-run the original scenario and relevant neighboring tests. If no adequate boundary exists, explain what the current test cannot prove rather than adding a misleading test or starting an unrelated redesign.

Derive required checks from current AGENTS.md and CI. Use npm run typecheck and the applicable Svelte check; bare tsc --noEmit against the root solution may inspect no source. Do not run mutation campaigns or deliberately break source. Preserve the initial failure, diagnose it, then rerun the affected scope after a relevant change. Reuse matching hosted checks instead of duplicating a full local suite.

Remove only this task's instrumentation and fixtures. Report measured cause, change, executed checks and remaining live-environment limits. Do not equate passing tests, a merged PR and an installed application.
