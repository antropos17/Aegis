# AEGIS project skills

This directory is the versioned source for project skills. Edit each skill here;
installations in `.agents/skills/` (Codex) and `.claude/skills/` (Claude Code) are
ignored local copies. Do not force-add those copies or copy local settings into
the catalog. A skill's location never selects the source checkout.
Before synchronization from a preserved checkout, resolve
[process-policy freshness](../../docs/development/current-context.md#process-policy-freshness).
Do not replace newer installed guidance with an older catalog merely because its
receipt permits the write. Preserve local customizations and inspect drift first.

Run from the intended worktree, with the repository's Node version:

```sh
node scripts/sync-agent-skills.mjs
node scripts/sync-agent-skills.mjs --write
node scripts/sync-agent-skills.mjs --check
```

The default command previews changes without writing; `--write` installs both
clients and `--check` exits nonzero for drift. No dependencies are installed.
The script targets the checkout containing the script, even if invoked from a
different working directory. It copies only catalog files and never deletes
unrelated skills, settings or extra files.

Existing identical files are adopted. A later catalog update may replace only
files whose content still matches the last installation receipt in ignored
`out/development/agent-skills.json`. A conflicting local edit, unknown differing
file, symlink or junction blocks the whole preflight. Review and preserve local
customizations before manually reconciling a conflict; there is no force flag.
Use one synchronizer at a time with no concurrent edits to the installation.
An I/O failure during writing can leave a partial installation; inspect its
reported error and rerun after resolving it. Do not treat the receipt as a
security boundary against an actor who can edit the checkout.

## Choose a skill

| Task | Skill |
| --- | --- |
| Checkout and architecture navigation | [aegis-context](aegis-context/SKILL.md) |
| Regression diagnosis | [aegis-diagnosing-bugs](aegis-diagnosing-bugs/SKILL.md) |
| Behavioral test-first implementation | [aegis-tdd](aegis-tdd/SKILL.md) |
| Test harness and evidence | [testing](testing/SKILL.md) |
| Main process / Svelte | [electron-main](electron-main/SKILL.md), [svelte-patterns](svelte-patterns/SKILL.md) |
| Interface integration or requested concept | [design-system](design-system/SKILL.md) |
| Scoped review / repository readiness | [aegis-code-review](aegis-code-review/SKILL.md), [audit-check](audit-check/SKILL.md) |
| Read PRs / check CI | [pr-monitor](pr-monitor/SKILL.md), [ci-monitor](ci-monitor/SKILL.md) |
| Commit and push / requested PR cycle | [commit-and-track](commit-and-track/SKILL.md), [ship](ship/SKILL.md) |
| Write a task prompt | [prompt-craft](prompt-craft/SKILL.md) |

Root [AGENTS.md](../../AGENTS.md), [coding standards](../../CODING_STANDARDS.md)
and the [development workflow](../../docs/development/workflow.md) own shared
rules. Skills contain task-specific decisions and consult those files in the
selected checkout. They do not grant delegation, publication or extra access.

## Client metadata and validation

`catalog.json` lists distributable files. Codex receives `agents/openai.yaml`
where present. Claude receives the same skill body and supporting files, with
`disable-model-invocation: true` added for `ship`. Codex's corresponding
`allow_implicit_invocation: false` is preserved. These intentional differences
follow [OpenAI skill guidance](https://developers.openai.com/codex/skills) and
[Claude skill invocation controls](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

Preserve the upstream attribution and LICENSE files for the adapted review,
diagnosis and TDD skills. Keep descriptions scoped, shared rules in their owners
and optional references behind task-specific pointers. Routing examples in
`aegis-context/references/trigger-cases.json` are review cases, not executed
agent evaluations. Run the focused `tests/main/agent-skills.test.js` suite for
synchronizer changes; verify frontmatter, local links and installation drift
when editing the catalog.
