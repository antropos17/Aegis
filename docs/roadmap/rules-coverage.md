# Rules coverage — C1 evidence and C2 scope

Checked against `8183226` on 2026-09-07. The relevant existing suites ran together:
72 tests passed across `rule-loader`, `rule-loader-yaml-parity`, `process-scanner`
and `process-observation`. Passing those suites does not establish the missing
requirements below.

The bodies of [#73](https://github.com/antropos17/Aegis/issues/73) and
[#75](https://github.com/antropos17/Aegis/issues/75) contain damaged inline code and
embedded historical command output. Required fields are taken from the production
`rules/_schema.json`; OpenClaw identifiers are taken from its database entry and
the production YAML. This reconstruction does not invent additional product rules.

## C1 — coverage before this change

| Issue requirement | Existing evidence | Verdict / gap |
| --- | --- | --- |
| #73 malformed YAML syntax / indentation | `tests/main/rule-loader.test.js`, “invalid YAML”, uses `tests/fixtures/rules/invalid-test.yaml`. That fixture is syntactically valid YAML with an invalid ID. | Absent for syntax errors; the schema-invalid case is covered. |
| #73 missing required fields | The fixture has all required fields; “each rule has required fields” checks accepted rules only. | Absent for rejection of omitted fields. |
| #73 empty YAML files | “empty directory” passes a nonexistent directory; no empty file is parsed. | Absent. |
| #73 duplicate IDs, warning and skip | “warns on duplicate and keeps first occurrence” explicitly uses no duplicates and asserts zero warnings. | Absent for actual duplicates; the no-false-warning case is covered. |
| #73 schema validation rejection | The invalid-ID fixture is excluded and an `Invalid ruleset` warning is asserted. | Partial: add isolated omission cases for the production schema's required fields. |
| #73 mixed valid and invalid rules in one file | Separate valid and invalid fixture files are loaded together. | Absent within one file. Schema validation is document-wide; a schema-invalid member rejects the document. A schema-valid member with an invalid regex is skipped individually during compilation. Test both boundaries. |
| #75 OpenClaw entry and aliases | `src/shared/agent-database.json` has `openclaw`, `moltbot`, `clawdbot`, `molty`. Generic scanner parity takes inputs from that same mutable database. | Partial: parity checks two scanner paths agree; it cannot detect a deleted alias or a consistently wrong owner. Pin the aliases and expected owner independently. |
| #75 OpenClaw and legacy configuration paths | `rules/ai-config.yaml` has AI013 (`.openclaw`), AI034 (`.moltbot`) and AI035 (`.openclaw/config.yaml`). YAML parity preserves their IDs and pattern bytes. | Partial: no dedicated positive/negative path assertions for these rules. |
| #75 known port 18789 | Present in the OpenClaw database entry. | Absent as an independent test assertion. |
| #75 legacy aliases resolve to OpenClaw | Generic scanner parity compares legacy and shared process-observation paths. | Partial: neither path is asserted against an independent OpenClaw result for each alias. |

Relevant implementation: [rule-loader.js](../../src/main/rule-loader.js),
[production schema](../../rules/_schema.json),
[agent database](../../src/shared/agent-database.json),
[AI configuration rules](../../rules/ai-config.yaml).

## C2 — bounded implementation

Add disposable-fixture tests for syntax failures, empty documents, missing required
fields, real duplicate IDs and the two mixed-rule failure boundaries. Assert that
a bad file does not discard a valid sibling file, that duplicates preserve the
first rule, and that category lookup reflects only accepted rules. Rename the
existing no-duplicate test to describe what it actually proves.

Add independent OpenClaw metadata assertions, real scanner calls for each pinned
alias, and Windows/POSIX configuration-path cases using the production rule loader.
Do not change production rules, matching behavior, agent metadata or the renderer
merely to increase test coverage.

## C2 — implementation and evidence

[rule-loader-edge-cases.test.js](../../tests/main/rule-loader-edge-cases.test.js)
adds 17 cases covering the #73 gaps above, using disposable files and the production
schema. Empty input must warn and preserve a valid sibling whether the parser or
schema rejects it. The existing no-duplicate test now names that narrower behavior.

[openclaw-detection.test.js](../../tests/main/openclaw-detection.test.js) adds nine
cases covering the #75 gaps: independent entry/alias/port/config metadata,
one real scanner call for each pinned alias, lookalike executable rejection, and
three production path rules with Windows/POSIX positive and negative examples.
This verifies discovery contracts, not a live Gateway installation or network probe.

The six affected suites passed together: 98 tests. Five deliberate mutations were
applied individually in an isolated checkout; every original file was restored
byte-for-byte after its run:

| Mutation | New tests that failed |
| --- | ---: |
| Bypass duplicate-ID skip | 1 |
| Bypass document schema validation | 10 |
| Remove the `molty` alias | 2 |
| Change the Gateway port from 18789 | 1 |
| Replace the AI013 path pattern with a nonmatching pattern | 1 |

Local mutation reports are in `X:/tmp/aegis-rule-coverage-mutations-20260907/`;
they contain disposable fixture results, not user data. No production source,
database entry or rule is changed by C2. Issues #73/#75 can close when this change
passes the required checks and merges.
