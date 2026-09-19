# AEGIS: protection from unsafe AI-agent actions

Research date: 2026-09-15. The user approved this plan in the current task.
Implementation baseline: `27c275a` from `origin/master`, version `0.15.0-alpha`.
The research compared documentation, selected source files and tests; external
products and attacks were not run. Competitor effectiveness was not measured.

## Goal and boundaries

Target product: "AEGIS protects your computer and data from unsafe AI-agent
actions." This includes mistakes, malicious skills/MCP, instruction hijacking,
data leaks, destructive operations and permission bypasses.

The current foundation is independent observation of processes, files and TCP
connections, attribution, history and correlations. Observation does not imply
prevention. Support the "antivirus against AI" description with tests of prevented
harm; whether arbitrary malware was created by AI is not a detection criterion.

Each item goes through a separate PR with checks. Automatic containment is
enabled only at an explicitly connected and tested execution control point.
Unknown agents, unsupported versions and sensor loss must remain visible as
coverage gaps. Do not label these states "safe".

## Implementation queue

| ID | Work | Completion criteria | Status |
| --- | --- | --- | --- |
| A1 | Local component snapshot of a specified project: MCP configs, hooks, instructions and skill files | Working CLI; bounded traversal and reads; hashes and structural counts; no server or command execution, network requests, or disclosure of contents/keys; visible errors and incompleteness | Implemented |
| A2 | User/system profile adapters, JSONC/TOML and provenance | Agent/version/OS/scope matrix; unsupported formats identified; local version and provenance evidence; scanning without execution | Implemented within A2.1–A2.2 scope; publisher and installation status remain unknown |
| A2.1 | Explicitly selected profiles, structural parsing and file provenance | CLI for user/managed directories; JSONC/TOML; hash, agent and scope; separate Codex profiles and Claude policy fragments; visible incompleteness and unknown version | Implemented |
| A2.2 | Local version and package provenance evidence | Associate a file with a manifest; compare name/full version with npm lockfile v2/v3; verify the manifest against local Git objects; explicitly report unknown publisher and installation status | Implemented; [contract](../PACKAGE-EVIDENCE.md) |
| A3 | Trust snapshots, comparison and update revalidation | File, tool schema/description and package changes are visible; acceptance is bound to content; changes are never accepted automatically | Implemented through CLI and [Local security](../LOCAL-SECURITY-UI.md); MCP uses an explicitly supplied offline tools/list; [contract](../INVENTORY-SNAPSHOTS.md) |
| A4 | Local static analysis of skills/hooks/MCP | Whole-package analysis of downloads, scripts, dependencies and data transfer; positive and negative fixtures; Cisco integrations through a versioned JSON/SARIF contract; external analyzers only when explicitly selected | Partial: A4.1, external-result import, bounded JavaScript/Python command and selected-source flow review, and instruction-pattern review are implemented; deeper analysis remains in A4.2 |
| A4.1 | Local command and configuration checks | CLI for projects, profiles and package trees; review reasons bound to hash/path; bounded shell/MCP/hooks/npm parsing; visible incompleteness; no execution or data transmission | Implemented; [contract](../STATIC-ANALYSIS.md) |
| A4.2 | Deeper analysis and Cisco integrations | Versioned JSON/SARIF contract, explicit offline inputs and result provenance; JS/Python and interfile flow analysis; complex shell and instruction semantics; unsupported cases receive no safety verdict | Partial: [Cisco JSON/SARIF import](../STATIC-REPORT-IMPORT.md), [JavaScript](../JAVASCRIPT-STATIC-ANALYSIS.md), [Python](../PYTHON-STATIC-ANALYSIS.md), [selected-source literal/wrapper/primitive-return flow](../STATIC-COMMAND-FLOW.md), [ordered shell redirections](../SHELL-REDIRECTIONS.md) and [bounded instruction-pattern review](../INSTRUCTION-REVIEW.md) are implemented; broader flow, shell control/substitution, general instruction semantics and additional MCP content channels remain |
| A5 | Refine SEQ001 and add behavioral chains | Ordinary work is not treated as proven exfiltration; missed-detection/noise tests; parent/child and cross-agent relationships retain attribution strength | Partial: SEQ001 calibration, SEQ002 direct relations, SEQ003 monitored ancestor paths and [offline lifecycle import](../HANDOFF-EVIDENCE.md) implemented; live collection, independent handoffs and general causal chains remain |
| B1 | Shared policy and adapter contract | Versioned events before/after actions; `allow/ask/deny`; supported and unsupported surfaces listed; ACS alignment assessed | Partial: [receiver envelope and policy contract](../AGENT-EVENT-CONTRACT.md), offline/live consumers, ACS assessment, provider fixture, decision/after session and direct execution; MCP revision binding and [one-attempt terminal confirmation](../ACTION-CONFIRMATION.md) and [opt-in MCP terminal review](../ACTION-MCP-REVIEW.md) added; broader routing and coverage remain |
| B2 | MCP gateway and operation control | Validate schemas, arguments, responses, recipients, access scopes and tool changes; stdio and HTTP have separate trust boundaries | Planned |
| B3 | Secret protection and limited permissions | Secrets cannot enter context or outbound requests outside policy; permission is bound to operation, recipient and task; expiry/single-use limits; replay protection | Planned |
| B4 | Protection against destructive actions | Control deletion, writes outside the project, publication and dangerous API operations before execution; confirm exact arguments; a timeout never becomes permission | Planned |
| B5 | Coverage interface in Observatory | "Observed", "Blocking verified", "Coverage lost"; agent/version/surface/last check; safe testing of an installed adapter | Planned |
| C1 | Protected Windows launch | Separate restricted context, file permissions and WFP; policy covers descendants; a separate broker supplies credentials; ordinary launch remains explicitly labeled observation mode | Planned |
| C2 | Protect AEGIS itself and resist bypasses | Validate processes using fresh identity; protect policies, keys, logs, IPC and service control; address direct egress that bypasses the proxy | Planned |
| C3 | Evidence and operational verification | Link decisions to actions, policy versions and sensor states; signed checkpoints; distinguish audit integrity from completeness; bounded rotation | Planned |
| D1 | Public effectiveness benchmark | Attacks and ordinary tasks on fixed versions; publish misses, false blocks, task success, latency/load and platform separately | Planned |

The first completed slice is A1 through `node src/main/main.js --inventory-json <project>`.
It snapshots known locations inside one explicitly selected directory. Discovery
does not establish installation, activity, malware checks or safety.
A2.1 added user and system directories through the separate command
`--inventory-profile-json <adapter> <directory>`; [matrix and limits](../PROFILE-INVENTORY.md).
A3 added separate commands to save a snapshot, accept an exact digest after a
fresh read, and compare snapshots. Arbitrary configuration references, downloaded
dependencies, live MCP calls, protection of the store against agent writes and
UI remain future work. A local snapshot is unsigned and does not prove who accepted it.
In A4.1, `--static-scan-json <adapter> <directory>` returns local heuristic
findings. `package` reads the selected package tree within limits; ordinary
adapters retain their declared scope. Unsupported languages and complex constructs
remain gaps. This slice does not complete all of A4.
The `--static-import-json` command adds an explicitly selected external result
to a fresh local scan. Provenance remains unverified; comparison with an earlier
`--static-scan-json` report shows changes to observed bytes but does not prove
that the external tool analyzed those bytes. Built-in JavaScript and Python review
resolve bounded literal process-call subsets and selected-source wrapper flows;
they do not evaluate control flow or establish runtime module identity.
Ordered shell redirections associate literal stdin/stdout endpoints while
retaining an explicit gap for the unverified shell and operating-system dialect.
Instruction-pattern review adds four English directive checks and an explicit
offline `--tools-file` input for MCP descriptions, with fixed signals and hashes.
Nonempty instruction text retains a semantic-coverage gap, including when no
pattern matched. No classifier result grants permission or suppresses that gap.
A4.2 remains incomplete.

## Architecture decisions

- Retain external OS observations as independent evidence. A hook reports intent
  or a result but does not by itself prove that all process actions were captured.
- Perform pre-execution checks in the gateway/adapter. Blocking after the fact
  cannot recover an already transmitted secret or undo a completed deletion.
- Enforcing a required network route needs OS controls. A proxy variable or shell
  interception cannot prevent a direct socket or another executable from bypassing it.
- An allowed domain does not authorize every operation. Check the API method,
  path, repository, recipient and content. A trusted LLM API can also receive a secret.
- Do not launch an unknown MCP server for an initial check. A separate active
  handshake may run in a restricted environment with an explicitly selected server.
- Exclude config contents, env values, tokens, secret-bearing arguments and memory
  text from logs/IPC/exports by default. Relative paths remain sensitive metadata;
  a hash is not a safety certificate.
- All traversal, read, time, queue and storage limits must expose incompleteness.
  Do not scan the entire disk at application startup.
- Enforce the base policy deterministically. LLM analysis may help explain a
  decision but must not independently grant additional permissions.
- Do not carry over obsolete constraints from the old renderer: the active
  interface in the selected baseline is `frontend/observatory/`.

## Reviewed projects and ideas to adopt

| Project / primary source | Verified mechanism | Limitation / decision for AEGIS |
| --- | --- | --- |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | Filesystem and network isolation of a process tree; the current Windows code uses a separate account and WFP | Research preview; requires sandboxed launch; reads need explicit restrictions; prototype C1 separately |
| [Windows wrapper source](https://github.com/anthropics/sandbox-runtime/blob/main/src/sandbox/windows-sandbox-utils.ts) | Wrapper around `srt-win`, SID and proxy | Source availability does not establish testing on our OS versions/builds |
| [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) | File/process/network policies, HTTP method/path and endpoint-bound credentials | Requires its own runtime; adopt task-specific access profiles |
| [Pipelock](https://github.com/luckyPipewrench/pipelock) | Inspection of HTTP/MCP traffic passing through it, DLP, description-tampering checks and signed decisions | [Bypasses and boundaries](https://github.com/luckyPipewrench/pipelock/blob/main/docs/bypass-resistance.md): proxy bypass, non-HTTP channels and regex limits; HTTPS payload inspection requires appropriate interception |
| [Pipelock tests](https://github.com/luckyPipewrench/pipelock/blob/main/internal/mcp/tool_description_rug_pull_test.go) | Tests for description tampering and ordinary description refinement | Adopt positive/negative scenario ideas without claiming another project's effectiveness rate |
| [Pipelock failure tests](https://github.com/luckyPipewrench/pipelock/blob/main/internal/proxy/scanner_unavailable_failclosed_test.go) | Operations fail when the scanner is unavailable | Test every transport surface where blocking is connected |
| [Cisco DefenseClaw](https://github.com/cisco-ai-defense/defenseclaw) | Scanners, runtime policies, audit and adapters | [Native Windows](https://cisco-ai-defense.github.io/defenseclaw/docs/get-started/windows/): limited to hook surfaces; no built-in OpenShell sandbox/model proxy; adopt the [compatibility matrix](https://cisco-ai-defense.github.io/defenseclaw/docs/connectors/compatibility/) |
| [Rampart](https://github.com/peg/rampart) | Local allow/ask/deny, audit and safe adapter checks | Cannot observe arbitrary internal actions of an allowed process; adopt checks that verify the control point actually works |
| [Snyk Agent Scan](https://github.com/snyk/agent-scan) | Agent, skill and MCP inventory; formerly MCP-Scan | Its API receives component data after redaction; stdio scanning launches the server; the CLI schema is unstable; adopt discovery without implicit execution/transmission |
| [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) | Local YARA, code and command-flow analysis | Keep optional LLM/API analyzers separate; no findings does not mean safe |
| [Cisco MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner) | Static checks of saved tools/prompts/resources | Prefer offline input; never execute contents in a privileged process |
| [AgentDojo](https://github.com/ethz-spylab/agentdojo) | Research environment for attacks and ordinary tasks | Add our own OS scenarios and validate scoring functions |
| [LLM Guard](https://github.com/protectai/llm-guard), [garak](https://github.com/NVIDIA/garak) | Content checks and model testing | Supplementary tools; they do not replace file, network and execution controls |

Before copying external code, record its commit and check LICENSE/NOTICE for the
specific file and dependencies. The research found Apache-2.0 for SRT, Pipelock,
Rampart and Snyk; Cisco Skill Scanner's LICENSE also contains Apache-2.0, although
the GitHub API returned NOASSERTION. API metadata is not a definitive license.

## Threats and primary sources

| Threat | Evidence and status | Items |
| --- | --- | --- |
| Instructions in an MCP tool description; changes after trust is granted | [Invariant: Tool Poisoning](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), demonstration | A3, B2 |
| Private data + untrusted input + permitted publication | [Invariant: Toxic Flows](https://invariantlabs.ai/blog/toxic-flow-analysis1), research | A5, B2–B4 |
| Hooks/MCP before consent and API endpoint substitution | [Check Point](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/), disclosed issues have been fixed | A2–A4, B3 |
| Malicious third-party skill | [Cisco: OpenClaw](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare), demonstration of a specific sample; not an estimate of catalog-wide infection | A4, B3 |
| Persistent memory poisoning | [OWASP: Memory](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/), guidance | A3, A5 |
| Dangerous composition of individually plausible skills | [ColluSkill](https://arxiv.org/abs/2608.09732), preprint dated 2026-08-10; the authors' results were not reproduced | A4–A5, D1 |
| Sandbox escape and protective network-policy bypass | [NVIDIA bulletin 2026-08-25](https://github.com/NVIDIA/product-security/blob/main/2026/5872/5872.md), listed OpenShell issues fixed in 0.0.34 | C1–C3, D1 |

## Security documentation

- [OWASP Agentic Top 10 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): map threats to features and checks.
- [OWASP Agent Control Standard](https://genai.owasp.org/resource/agent-control-standard-acs/) and [code/specification](https://github.com/GenAI-Security-Project/agent-control-standard): portable hooks and policies; published by OWASP in September 2026.
- [OWASP September update](https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/): account for the LLM Top 10 update and keep it distinct from Agentic Top 10.
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices): token audience, no token passthrough, SSRF, OAuth, sessions, local servers and scope minimization.
- [MITRE ATLAS](https://ctid.mitre.org/blog/2026/05/06/secure-ai-v2-release/): techniques, real cases and evidence maturity; associate rules with identifiers.
- [NIST Agent Identity and Authorization](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents): a concept paper on authority and identity, not a certification.
- [GitHub Agentic Workflow Firewall](https://github.github.com/gh-aw-firewall/reference/security-architecture/): enforced egress and failure modes for CI; filesystem isolation needs a separate mechanism.

## Reddit: ideas, not effectiveness evidence

- [Rampart discussion](https://www.reddit.com/r/aiagents/comments/1rq7j7l/i_built_an_opensource_firewall_after_watching/): secret leakage into context, temporary permissions and shell/LD_PRELOAD bypasses. Features were checked against the current repository; older integration instructions may be outdated.
- [MCP-DecayBench discussion](https://www.reddit.com/r/mcp/comments/1vn8u43/mcpdecaybench_two_mcp_security_scanners_score/): identical aggregate scores can conceal different misses. Adopt rephrasing and renaming with unchanged behavior; do not treat the discussion's ranking as verified.

## Tests and release criteria

For every controlled action, test an ordinary scenario, a dangerous scenario,
protective-component failure and an attempted bypass. D1 includes:

- reading a secret and sending it to a new or allowed destination;
- sending a secret to an LLM API, in a URL/header/body or encoded form;
- changes to MCP descriptions/schemas, hooks, skills, memory and API base URLs;
- deletion/writes outside the project and publication to the wrong recipient;
- direct IP, IPv6, DNS, child processes, proxy bypass and symlink/reparse points;
- PID substitution, sensor termination, audit loss and queue/disk exhaustion;
- ordinary build/test/git operations, recording false blocks.

Measure prevented harm, attack success, ordinary-task success, false blocks,
missed events and latency/load separately. Record client/OS/policy versions,
seed and corpus hash. Test external integrations with separate fixtures,
dummy credentials and a local receiver.

Retain the current ten CI checks and five required contexts. New tests use
disposable fixtures. Cache lives in the worktree on X:; test TEMP lives in a
separate directory on X: outside the repository, because the benchmark forbids
a profile inside the observed project.
Remove closed temporary results after checks and retain receipts.
Do not start another heavy batch while diagnostic-log growth is unexplained.

## Execution log

- 2026-09-15: A1 implemented through the existing CLI before Electron is imported.
  [Contract and usage](../PROJECT-INVENTORY.md) describe scope, limits and exit
  codes. Full local test:coverage passed after moving TEMP outside the repository;
  the initial failure was the benchmark profile-location check. Build, format,
  lint, typecheck, svelte-check, audit and both mutation gates passed. Next is A2;
  A2–D1 are not yet implemented. GitHub CI and merge results are recorded in the PR;
  the installed release is updated separately.
- 2026-09-15: A2.1 adds JSONC/TOML and seven explicitly selected profile adapters.
  Codex `NAME.config.toml` files and Claude `managed-settings.d/*.json` fragments
  are read separately; `.claude.json` provides only user/project-local MCP counts.
  Schema 2 records file provenance from the selected layout, but retains
  `agentVersion: null` and `packageIdentity: not-resolved`: a directory name
  does not verify a package. Next is A2.2. Two parser dependencies are pinned to
  exact versions; existing lockfile entries were preserved. Checks and merge
  results are recorded in the PR.
- 2026-09-15: A2.2 adds schema 3: local package manifests, comparison against npm
  lockfile v2/v3 and manifest-content verification against loose Git objects.
  Full versions are compared; private names and version suffixes are emitted
  only as hashes. `packageRef` indicates membership in a package directory;
  installation, publisher and signature are unverified. Packfiles, external Git
  stores and indirection are not read. Limits are shared with inventory, with a
  separate decompression bound. No new dependencies or lockfile changes. Next is
  A3: saving snapshots, comparing updates and making a new trust decision.
  Local checks and GitHub CI are recorded in the PR.
- 2026-09-15: A3 saves a separate observed snapshot outside the inspected directory.
  Acceptance requires an exact digest and a fresh match; it creates a new file
  without overwriting the previous one. Diff shows files, metadata, packages and
  explicitly supplied MCP descriptions/schemas, requiring review for changes,
  scope changes or incompleteness. Missing data is not declared deleted.
  The MCP catalog is read from one bounded JSON export without launching a
  server; nextCursor prevents treating the first page as complete. No signature,
  rollback protection, store-permission protection or action blocking is claimed.
  Next is A4, local static analysis of skills/hooks/MCP. Checks and merge results
  are recorded in the PR.
- 2026-09-15: A4.1 adds static checks STA001–STA011: downloads piped into an
  interpreter, sensitive-file/variable transfer, root/home deletion, encoded
  PowerShell, Claude permission bypass, mutable npx/remote sources, MCP URLs,
  ANTHROPIC_BASE_URL and lifecycle scripts. The report contains reasons, hashes,
  paths and line numbers, without source text, commands, addresses or secret
  values. No real processes/servers are launched. Quotes, argv, non-executable
  examples, incompleteness and limits are tested with positive and negative
  fixtures. JS/Python, prompt-injection semantics, interfile flows and Cisco
  JSON/SARIF remain in A4.2. Overall A4 is marked partially complete. Checks and
  merge results are recorded in the PR.
- 2026-09-15: the first A4.2 PR adds import of one Cisco Skill Scanner JSON result,
  a SARIF 2.1.0 subset and MCP Scanner raw-envelope JSON. The AEGIS contract is
  versioned and lists the checked upstream revisions. External safety flags,
  exceptions, messages and snippets do not become permissions or free-form report
  text. Fixed categories, severity, ordinals, identifier hashes and explicitly
  mapped paths are retained. SARIF suppressions do not hide findings; analyzer
  failures, meta-filtering, unsupported references/flows and limits are visible.
  MCP summaries retain the reported hit count without presenting those hits as
  individual findings. A previous local report is optional and is not treated as
  signed proof of execution. This PR adds no Cisco installation/invocation,
  network transmission, AST/dataflow engine or semantic analysis.
  Next in A4.2: built-in JS/Python and interfile-flow checks.
- 2026-09-15: the JavaScript A4.2 slice parses selected `.js`, `.cjs` and `.mjs`
  files without executing them. Imports, aliases, constant strings and inline
  argv/options reach existing STA001–STA006 checks with original hashes and call
  locations. Lexical shadows, mutations, dynamic inputs, unexamined control flow
  and resource caps remain visible. Rule-set version 2 adds explicit JS scope
  and budgets; earlier scan baselines require fresh comparison. Acorn 8.16.0 is
  promoted from an existing locked entry to an exact production dependency.
  Tests cover findings, negative cases, non-execution, redaction and bounded work.
  Next in A4.2: Python, then interfile/interprocedural flow and instruction semantics.
  Checks and merge results are recorded in the PR.
- 2026-09-15: the Python A4.2 slice reviews literal `subprocess` and `os` process
  calls in selected `.py` files without starting Python. It preserves argv/shell
  distinctions, resolves selected imports and single-assignment strings, and
  exposes scope, mutation, encoding and resource gaps. Rule-set version 3 adds
  Python coverage metadata and requires fresh comparison for older baselines.
  Lezer's Python grammar and its three runtime dependencies are pinned in added
  lockfile entries; existing records are preserved. CLI fixtures check that source
  is not executed. Next in A4.2: interfile/interprocedural flow and instruction
  semantics. Verification and merge results are recorded in the PR.
- 2026-09-15: selected-source A4.2 flow links imported literal strings and simple
  JS/Python wrappers through an in-memory catalog of already read files. Findings
  bind the caller, process-call location and contributing sources to their original
  hashes. Resolution never adds reads or executes source; ambiguity, mutation,
  recursion, resource limits and runtime-resolution uncertainty remain visible.
  Rule-set version 4 adds flow scope/budgets and requires fresh older-baseline
  comparison. Next in A4.2: broader value/return flows, complex shell and instruction
  semantics. Checks and merge results are recorded in the PR.
- 2026-09-16: primitive function-return flow extends the selected-source A4.2
  subset. Simple JavaScript/Python return helpers can feed command arguments and
  supported wrappers while retaining caller, sink and transitive source hashes.
  Return and wrapper expansion share recursion, call and work limits. Unsupported
  bodies, mutable/escaped identities and process-call return values remain unknown.
  Rule-set version 5 declares return coverage and requires fresh comparison for
  older baselines. CLI checks cover non-execution, redaction, changed dependency
  bytes and adapter exclusions. Next in A4.2: complex shell and instruction
  semantics; general object/closure flow remains outside this bounded subset.
  Verification and merge results are recorded in the PR.
- 2026-09-16: ordered shell redirections extend the literal-command A4.2 subset.
  Overridden stdout no longer becomes a download-to-shell pipe, and sensitive
  file paths supplied through stdin can produce STA002 without reading those
  targets. Descriptor copies retain their position in the redirect sequence;
  unknown descriptors and unsupported copies/moves invalidate stream inference.
  Parsing permits at most 64 redirections within the existing command/token
  bounds. Rule-set version 6 declares the new scope and requires fresh comparison
  for older baselines. CLI, JS/Python, MCP, hooks and npm-script fixtures check
  the public boundaries, redaction, original hashes and non-execution. The actual
  shell dialect, prior file content, arbitrary nested shell flow, control flow,
  substitutions and instruction semantics remain unresolved. Next in A4.2:
  instruction-content review with explicit evidence and bounded coverage.
  Verification and merge results are recorded in the PR.
- 2026-09-16: bounded instruction-pattern review adds STA012–STA015 for prior-rule
  override, sensitive transfer, consent bypass and action concealment. Original
  file hashes/lines and fixed signals bind findings without returning source text.
  Optional `--tools-file` reuses strict offline catalog admission and reviews
  top-level descriptions, preserving source/descriptor hashes and original tool
  ordinals. It never connects to a server or follows catalog references. Negation,
  quoted context, source boundaries and resource caps have explicit tests.
  Every nonempty text retains the semantic gap; unknown content is never declared
  safe. Rule-set version 7 and scope/limits require fresh older-baseline review;
  a catalog-selected baseline cannot match an import scan that omitted it.
  General instruction semantics and additional MCP channels remain open in A4.2.
  Next in the implementation queue: A5, behavioral chains with explicit attribution
  and noise/missed-detection tests. Verification and merge results are in the PR.
- 2026-09-16: the Observatory Local security workspace exposes the implemented
  A1–A4 workflows: scoped local scans, component/package inventory, offline MCP
  catalogs, snapshot comparison and Cisco report import. Evidence retains source
  locations and hashes, incomplete coverage and unverified external claims. Native
  dialogs select files; exports create new redacted reports, and explicit snapshot
  acceptance rechecks the observed content before saving. Browser preview uses
  labeled fixtures with persistent actions disabled. See [the UI guide](../LOCAL-SECURITY-UI.md)
  for operating limits. A5 is the next implementation stage.
- 2026-09-16: the first A5 slice calibrates SEQ001 using bounded TCP observation
  history, file event kind and per-step ownership. Existing connections remain
  informational audit evidence; incomplete evidence caps severity at low and a
  file-access event followed by a first TCP observation caps at medium. Sensitive
  basenames include `.env` and standard SSH private keys, and all TCP ports are
  eligible regardless of endpoint allowlisting. The Audit detail view exposes
  ordered steps, endpoints, owner evidence and the absence of transfer proof.
  See [the evidence contract](../SEQUENCE-EVIDENCE.md). Tests cover noise, missed
  cases, identity separation, score retention and bounded metadata/history.
  Next in A5: parent/child and cross-agent causal evidence with explicit uncertainty.
- 2026-09-16: SEQ002 adds direct monitored-parent/child observations in either
  direction, including differently named agents. Fresh OS-backed endpoint identities
  and ordered births establish the observed relation; each event keeps its own actor.
  Missing, stale or failed population observations invalidate related evidence.
  The tracker has explicit population, edge, fanout and anchor limits. Severity is
  at most low, with no claim of delegation or transferred content. Audit details
  display the two participants and relationship snapshot times. Tests cover PID
  reuse, ownership, outages, expiry, caps and exclusion of name/cwd/sibling joins.
  Next in A5: indirect process paths and independently evidenced agent handoffs;
  generic causal inference and action blocking remain unimplemented.

- 2026-09-16: SEQ003 correlates file/TCP observations across two to four monitored
  parent links. Every intermediate identity is retained and the full ordered path
  must persist across the observations; gaps, intermediate replacement or exit,
  reparenting and expired snapshots invalidate it. Direct rules have admission
  priority within shared relationship and anchor caps. Audit displays the full
  path and separate event owners. Low severity remains the ceiling; ancestry
  establishes neither delegation nor transferred content. Tests cover both
  directions, depth boundaries, path replacement, exclusion of siblings, caps,
  ownership and metadata-only evidence. Next in A5: independently evidenced agent
  handoffs. Unmonitored helpers and general causal inference remain uncovered.
- 2026-09-16: reviewed Claude Code lifecycle hooks, OpenAI handoff span data,
  A2A task/context identifiers and the OpenTelemetry GenAI documentation location.
  Existing token accounting cannot establish a separate subagent process or
  handoff. The [handoff design](../HANDOFF-EVIDENCE.md) separates provider reports,
  authenticated delivery, fresh OS binding and transfer evidence. Next: implement
  an explicit bounded offline lifecycle importer with opaque report-local IDs,
  privacy tests and no scoring. Live correlation depends on B1's adapter boundary;
  no handoff collection or additional protection is implemented by this review.
- 2026-09-18: `--handoff-import-json claude-code <events.jsonl>` now imports an
  explicitly selected offline JSONL file before Electron starts. Fixed byte,
  record, event, identity and diagnostic bounds expose incomplete processing.
  Reports contain only event kinds, record ordinals and opaque import-local
  references; producer text, paths, raw IDs and forged ownership are discarded.
  Provenance remains unverified, process binding absent and transfer unobserved.
  Synthetic tests cover malformed/private data, limits, file changes and the CLI
  boundary. This does not alter monitoring, scoring or Audit. Next: B1's shared
  event/adapter boundary and tested opt-in live collection; A5 remains partial.

- 2026-09-18: the first B1 slice routes offline lifecycle import through a
  receiver-owned source registration and versioned metadata envelope. Report
  schema 2 exposes intake receipts, replay rejection, gaps and sticky loss,
  without authentication, OS binding or a policy permission. Shared lifetime
  budgets and close/restart behavior have synthetic tests. The
  [contract](../AGENT-EVENT-CONTRACT.md) defines future before/after and
  allow/ask/deny semantics, surface gaps and an initial pinned ACS comparison.
  Next: opt-in live lifecycle intake and, separately, a tested execution adapter.
  B1 and A5 remain partial. Verification and merge receipts are in the PR.

- 2026-09-18: B1 now includes an explicitly started finite loopback collector and
  a command-hook sender that projects lifecycle metadata before sending. Bearer
  possession, per-run delivery IDs and byte/time/rate/connection/identity limits
  bound intake without asserting agent identity or prevention. Real HTTP/Node
  synthetic tests exercise privacy, rejection, replay, expiry and capacity. The
  [live contract](../LIVE-LIFECYCLE.md) documents setup and trust limits. Running
  provider-driven hooks remains unverified; no existing settings were changed.
  Next: isolated provider verification and the separate execution/policy adapter.

- 2026-09-18: B1 adds an experimental [exact-input Bash policy hook](../ACTION-POLICY-HOOK.md).
  It reads a bounded explicitly selected policy and returns allow/ask/deny before
  execution, with fixed output and deny on AEGIS-controlled failures. Actual
  Windows Claude 2.1.263 with a local model stub exercised allow/deny sentinel
  effects and delivered lifecycle events through the real sender/collector.
  Provider hook launch/timeout bypasses, delegated approval, input mutation and
  after-action binding remain open; this is not a general fail-closed gate.
  B1 stays partial. CI/publication receipts are in the implementation PR.

B1 continuation: the bounded [action session](../ACTION-POLICY-SESSION.md) links a
local policy decision to one exact-input after report, with replay tombstones,
deadlines and capacity bounds. Its consumer is the opt-in installed-provider
fixture; production execution mediation and exact approval binding remain open.

B1 explicit execution: `--action-exec-json` now evaluates a complete selected
executable/cwd/arguments/environment request and owns direct child launch only on
allow. Ask, deny and preparation failures do not launch. Runtime/output bounds
and direct-child termination evidence are explicit; descendants and outside-route
activity remain unsupported. See [execution contract](../ACTION-EXECUTION.md).

B1 agent route: the [selected-action MCP stdio adapter](../ACTION-MCP.md) exposes
one operator-selected action through AEGIS-owned execution, with bounded protocol
handling, typed replay protection and cancellation on disconnect. It does not
route native agent Bash or other MCP tools and does not implement the B2 gateway.

B1 revision continuity: MCP initialization now pins the selected request and
policy bytes privately for that connection. Observed changes and read failures
revoke the scope; restoring files cannot revive it. Each evaluation checks the
same bytes it parses, and launch rechecks scope liveness. Native stdio mutation
fixtures and the installed Claude allow/deny/ask fixture passed. This is not
human approval or continuous change detection.

B1 terminal confirmation: `--action-exec-confirm` displays the complete effective
action privately on a terminal and requires a fresh literal challenge response.
The owner pins configuration before review and grants one launch attempt for five
seconds after confirmation; deny cannot be overridden. The runner rereads pinned
files before launch. TTY/PTY interaction does not authenticate a human. Direct
MCP stdio ask remains unstarted; broader routing and coverage remain.
See [the confirmation boundary](../ACTION-CONFIRMATION.md) for privacy, limits and
verification scope.

B1 MCP review route: `--action-mcp-review` now publishes an exclusive private
endpoint for `--action-mcp-connect`. One authenticated loopback connection can
request the selected tool; each allow/ask call requires fresh terminal review
against the same connection revision binding. Deny cannot be overridden. The
bearer requires a trusted private directory, and terminal automation does not
authenticate a human. See [the broker boundary](../ACTION-MCP-REVIEW.md) for finite
transport limits, conservative cleanup and native verification scope.

B1 broker provider verification: installed Windows Claude Code 2.1.263 passed
approved ask, explicit negative answer, policy deny without a preview, and
disconnect after a drained preview through the actual relay. Seven local
synthetic API requests produced the expected results; private-canary checks and
broker, endpoint and scratch cleanup passed. This establishes the selected route
only; it does not authenticate human presence, verify a cloud model or provide OS
isolation. Reproduction and receipt location are in the broker contract.

B1 route coverage check: `--action-route-check-json` now evaluates explicitly
selected policy/request files for direct, terminal, MCP stdio and MCP review
routes. Its machine-readable result separates current-process prerequisites and
policy decisions from unknown outside-route coverage and unverified connection/
blocking. It performs no execution, confirmation or listener setup; exit zero
includes a valid deny and grants nothing. The check retains no revision binding.
See [the route-check contract](../ACTION-ROUTE-CHECK.md). Broader routing and
observed coverage display remain open.

B1 deliberate routing: the [operator-selected MCP catalog](../ACTION-MCP-CATALOG.md)
publishes up to eight fixed argument-free actions, with one shared execution slot,
replay set and budget. Direct stdio and terminal-review broker routes reuse each
entry's revision binding and the existing execution owner. Initialization is
atomic under one deadline; manifest edits apply on a new connection. This broadens
operator-selected routing while other agent tools and observed coverage remain
outside scope.

B1 catalog provider verification: installed Windows Claude Code 2.1.263 passed
two distinct allowed calls in one connection and separate deny/ask checks, plus a
terminal sequence of confirmation, explicit refusal and disconnect before a third
launch. Correlated reports and intermediate sentinel observations prove the order.
Ten synthetic loopback API requests covered the direct and review runs; private
canary checks, provider-tree cleanup and endpoint/scratch removal passed. This
evidence covers the configured catalog route with local model replies; cloud-model
behavior, human authentication and OS isolation remain unverified. Reproduction
commands and redacted receipt locations are in the catalog contract.

B1 whole-catalog preflight: `--action-catalog-check-json` reports current
configuration and per-tool policy decisions for direct stdio or terminal review.
The check reuses catalog admission and revision-bound evaluation under one
deadline, then revokes all temporary bindings. It never launches, listens,
connects or grants permission. Cancellation, timeout and observed revocation
discard partial results. Valid deny remains a successful configuration check.
See [the catalog-check contract](../ACTION-ROUTE-CHECK.md#whole-catalog-check).

B1 connection observations: the fixed read-only MCP tool
[`aegis_route_status`](../ACTION-MCP-STATUS.md) reports owner invocation,
settlement, failure and cancellation counters for the current connection. It is
available during execution/review without invoking an action, while preserving
the message/replay limits. Cancellation remains a request; neither settlement nor
idle status establishes execution success, termination or global protection.
No private action data or client identity is retained in these observations.
The Observatory coverage interface and verified outside-route control remain open.

B1 explicit client setup: `--action-mcp-config-json` now produces literal client
configuration for a selected action, catalog or separate review relay. It uses
the current Node executable and source entry, validates bounded local path syntax,
and performs no file read, server start, preflight or settings installation.
The export intentionally contains selected paths and no bearer, environment or
action contents. Native generated-config checks and installed Claude fixtures
cover all three modes. See [the setup contract](../ACTION-MCP-CONFIG.md).
