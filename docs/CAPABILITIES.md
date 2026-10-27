# AEGIS capabilities

The main source review used the 16 October 2026
[revision `6001f2c`](https://github.com/antropos17/Aegis/tree/6001f2c295e42392967a845760c8fce14461b35a).
Later source work and acceptance boundaries are tracked in the
[completion plan](roadmap/completion-plan.md); the tables below retain the
scope of the reviewed entry points unless a later qualification is linked.
At that 16 October checkpoint, the published Windows installer was
[0.19.2-beta](releases/0.19.2-beta.md), dated 6 October. See
[GitHub Releases](https://github.com/antropos17/Aegis/releases) for current
installers and their release notes. Later source work needs a later installer
release; the package version alone does not identify which unreleased changes an
installed build contains. Dated qualification evidence applies to its named artifacts.

## Choose an entry point

| Surface | Availability | Start here |
| --- | --- | --- |
| Observatory desktop | Local monitoring and review in current source | `npm start`, or a verified published installer |
| Browser preview | Simulated data, shared desktop components, native/provider actions disabled | `npm run dev`; [screenshots](screenshots/README.md) |
| CLI and selected-action MCP | Explicit operator configuration and trusted selected inputs | [Execution](ACTION-EXECUTION.md), [client configuration](ACTION-MCP-CONFIG.md) |
| Validating MCP gateways | Explicitly selected server, endpoint, accepted manifest and grants | [stdio](MCP-STDIO-GATEWAY.md), [HTTP](MCP-HTTP-GATEWAY.md), [HTTPS](MCP-HTTPS-GATEWAY.md) |
| Administrative protected VM APIs | Experimental elevated Windows lab operations; ordinary launch disabled | [Provisioning](roadmap/enforcement-e2/protected-vm-creation.md), [guest run](roadmap/enforcement-e2/protected-guest-start.md) |

Windows is the primary platform. macOS and Linux remain experimental, with
different sensors and process-identity guarantees. Windows-specific containment
routes do not imply cross-platform isolation.

## Monitor and investigate

| Feature | Current behavior | Coverage boundary |
| --- | --- | --- |
| Agent recognition | 112 agents and 265 process-name signatures; parent/child and IDE-host evidence; editable agent catalog | Signatures and parent evidence can miss or misclassify activity; recognition is not a trust decision. |
| Instance radar | Separate stamped process instances, host/application grouping, selection, filters and activity details | A missing identity witness stays unavailable; radar positions are a visualization. |
| File activity | Configured sensitive-directory watchers, Windows handle/Restart Manager observations and explicitly started experimental Windows file-read capture | A watcher event can be unattributed; read paths remain candidates, and read observations do not change risk scoring or audit history. [Setup and qualification](development/ordinary-file-reads.md). |
| TCP endpoints | Connections for detected agent PIDs, forward-confirmed reverse DNS and endpoint verdicts | Endpoints do not expose encrypted payloads or establish the purpose of a connection. |
| Resource charts | Process CPU/RAM and complete available NVIDIA VRAM samples, Statistics and per-agent history | NVIDIA CLI admission uses default driver paths; missing or partial per-PID totals stay missing. WDDM can report unavailable process memory; VRAM allocation does not measure inference. |
| Token accounting | Measured Claude Code input/output/cache subtotals from matching local session data, durable deduplication and estimated costs | Requires a readable matching transcript and start-time witness; other agents can show estimates. Collection can lag or be incomplete. See [token accounting](TOKEN-ACCOUNTING.md). |
| WSL inventory | Bounded list of running distribution names and independent freshness | No guest process execution or per-distribution agent attribution. |
| Docker candidates | Local running-container image metadata and bounded selected configuration observations | Fixed local CLI admission; remote endpoints refused. Candidate metadata does not prove a running agent or contain it. |
| Podman candidates | Linux-native local container metadata with a fixed local configuration overlay | Other platforms and remote configurations are unavailable; container namespace PIDs are not host process identities. |
| Sensor health | Process/file/network availability, retained stale observations and observed coverage gaps | Health does not prove complete capture or recover events missed during an outage. |
| Manual process actions | User-selected terminate, suspend and resume through platform-specific controls | Identity and OS support govern availability; these actions do not preapprove or isolate future launches. |

The active [navigation registry](../frontend/observatory/runtime/navigation.ts)
and [desktop host](../frontend/observatory/runtime/host.ts) define the workspace
entry points. Advanced navigation is the default. Simple navigation groups
investigation, file checks and settings; Commands (`Ctrl K`) provides task search.
English and Brazilian Portuguese, four themes, enlarged text and reduced motion
are supported. See [guided workflows](OBSERVATORY-GUIDED-WORKFLOWS.md).

## Review local files before use

The [Local security workspace](LOCAL-SECURITY-UI.md) uses native selection of an
explicit directory or input file. It does not automatically scan the user's home,
start an agent/MCP server or upload the selected content.

| Review | Result | Guide |
| --- | --- | --- |
| Project/profile inventory | Recognized packages, locks, Git/configuration evidence and MCP tool fingerprints | [Inventory](PROJECT-INVENTORY.md), [profile layouts](PROFILE-INVENTORY.md) |
| Static security scan | Bounded source findings, selected command-flow and instruction-pattern evidence, hashes/available lines and explicit gaps | [Static analysis](STATIC-ANALYSIS.md), [command flow](STATIC-COMMAND-FLOW.md), [instruction review](INSTRUCTION-REVIEW.md) |
| Snapshot comparison | Added, changed and removed observations; scope incompatibility and incomplete captures remain distinct | [Local security operations](LOCAL-SECURITY-UI.md#operations) |
| Accepted snapshot | Explicit acknowledgment and a fresh complete matching capture before saving an accepted copy | [Review and persistence](LOCAL-SECURITY-UI.md#review-and-persistence) |
| Offline external reports | Cisco JSON/SARIF claims matched against a fresh built-in review, retaining unverified provenance | [Report import](STATIC-REPORT-IMPORT.md) |

No findings and unchanged hashes do not establish safety. Static review does not
resolve effective agent permissions, all configuration inheritance, general
instruction meaning or future runtime behavior. Saved snapshots record local
decisions; they do not authenticate a publisher.

## Rules, audit and reports

| Feature | Current behavior | Limit |
| --- | --- | --- |
| Detection rules | 73 sensitive-path rules across 8 categories; editable YAML and schema validation | File classification is separate from attribution and prevention. |
| Baselines and risk | Rolling session baselines, time-decayed scoring and anomaly evidence | Scores support review; no general detection or false-positive rate is established. |
| Sequence correlations | Ordered evidence with bounded state, relation/attribution checks and behavioral regression coverage | Correlation does not prove exfiltration or causality. See [sequence evidence](SEQUENCE-EVIDENCE.md). |
| Audit history | Daily hash-chained JSONL, 30-day retention and a rebuildable SQLite query index | Local chains require a trusted comparison state and cannot establish completeness. See [audit counters](AUDIT-COUNTERS.md). |
| Reports and export | JSON, CSV, HTML and diagnostic ZIP; captured selection and coverage stay visible | Paths/endpoints remain sensitive; settings copies omit the configured API key. |
| Optional AI analysis | Native confirmation before sending activity metadata to Anthropic using the configured key | Separate from offline review; external service charges and data disclosure apply. |
| Settings and updates | Monitoring presets, watch paths, themes, configuration import/export and opt-in signed Windows update verification | UI permission labels and endpoint allowlists do not enforce general OS blocking. |

See [privacy architecture](../SECURITY.md#privacy-architecture),
[alerts and permissions](ALERTS-AND-PERMISSIONS.md) and
[release verification](RELEASE-VERIFICATION.md). Monitoring has no usage telemetry
or cloud sync; endpoint naming uses DNS, and requested update/AI actions use their
documented external services.

## Control selected actions

These are operator-configured routes. Ordinary agent commands do not automatically
enter them. Direct and Job-only execution retain the caller's file/network access.

| Route | What it controls | Setup |
| --- | --- | --- |
| Exact action policy | Selected executable, working directory, arguments and explicit environment; deny/preparation errors never launch | [Execution contract](ACTION-EXECUTION.md) |
| Terminal confirmation | Fresh review for one eligible launch attempt; deny cannot be overridden | [Confirmation](ACTION-CONFIRMATION.md) |
| Windows Job | Suspended launch assigned before execution; ordinary member descendants close when confirmed cleanup completes | [Job lifetime](ACTION-EXECUTION.md#opt-in-windows-job-lifetime-route) |
| Windows AppContainer | One reviewed offline action in a fresh retained workspace, verified zero-capability token and Job | [AppContainer contract](ACTION-APPCONTAINER.md) |
| Selected-action MCP catalog | Up to eight fixed argument-free tools, revision binding and optional terminal review per eligible call | [Catalog](ACTION-MCP-CATALOG.md), [terminal broker](ACTION-MCP-REVIEW.md) |
| Exact file deletion | One AEGIS-owned selected-file operation after mandatory terminal review | [Deletion](ACTION-DELETE-FILE.md) |
| Configuration checks | Nonexecuting desktop/CLI route and catalog checks; captured policy outcomes | [Action control](ACTION-COVERAGE-UI.md), [route check](ACTION-ROUTE-CHECK.md) |
| Connection observation | Current MCP counters and opt-in read-only desktop observation with sticky coverage loss | [Status](ACTION-MCP-STATUS.md), [live observation](ACTION-LIVE-OBSERVATION.md) |

Generated [client configuration](ACTION-MCP-CONFIG.md) requires explicit loading
in the selected client. It includes private local paths and does not install
settings or attest compatibility. Terminal previews can disclose secrets in
scrollback; terminal automation does not establish a human's identity.

## Validate explicitly routed MCP traffic

The validating gateway is distinct from publishing selected-action tools. It
interposes only on its configured connection and selected server.

| Capability | Scope |
| --- | --- |
| [stdio gateway](MCP-STDIO-GATEWAY.md) | Exact launch-policy allow, accepted tool catalog, bounded schema validation, exact one-attempt grants and structured response checks. |
| [Loopback HTTP](MCP-HTTP-GATEWAY.md) | Finite JSON/SSE profile with pinned local endpoint/session handling and bounded cancellation/cleanup. |
| [Pinned HTTPS](MCP-HTTPS-GATEWAY.md) | Explicit URL, connection IPv4, selected CA, server name and leaf fingerprint; selected bearer credentials. |
| [Persistent grants](MCP-DURABLE-GRANTS.md) | Expiry and consumption across restarts; versioned route, bearer and effective stdio descriptor binding through the selected store. |
| [Known-secret policy](MCP-KNOWN-SECRETS.md) | Explicitly supplied values and a finite set of encodings in tool metadata, arguments and results. |

OAuth, general recipient/scope enforcement, arbitrary MCP content channels,
general data-loss prevention and activity outside these routes remain incomplete.
An accepted catalog/grant does not establish server safety or protect a local
store against every process with the user's privileges.

## Experimental administrative Hyper-V execution

The [fresh-VM installer](roadmap/enforcement-e2/protected-vm-creation.md) creates
an Off Generation 2 VM, original standalone disk and private admitted image with
full SHA-256 checks, private High-integrity storage and journals written before
provider effects. It refuses adoption and parent-backed private disks.

The separate [guest-run API](roadmap/enforcement-e2/protected-guest-start.md)
hydrates the original disk from a trusted offline Windows VHDX, preserves its file
identity, and starts/stops the created VM through a retained native owner. It
requires fixed 4 GiB RAM, two processors, Secure Boot, no NICs/checkpoints, original
media and agreement between native and fresh Hyper-V state observations.

One bounded package can run through administrative PowerShell Direct under a
fresh ordinary guest account. Before resume, its suspended process must pass
SID/groups/elevation/session/image/birth and initial Job checks on a private
desktop. Limits are an enforced 512 MiB user allocation quota, 32 Job processes,
512 MiB per process and aggregate Job memory, and 120 seconds maximum execution.
Success requires whole-Job and desktop closure; cleanup verifies native Off,
original disk identity and exact VM removal.

[Hosted evidence on source `5113e3b`](roadmap/enforcement-e2/protected-guest-hosted-evidence-20261016.md)
records actual provisioning, Windows boot, standard-user execution, quota refusal
and descendant cleanup. Base images and administrators remain trust inputs.
Quota accounting does not constrain writes charged to privileged services or
files owned by other principals. Unknown VMMS settlement retains state and has
no recovery/restart API.

Ordinary installed-caller authorization, authenticated runtime communication,
cancellation/owner-loss supervision and result review still need integration and
acceptance. Independent enforcement A1–A4 review remains open;
`launchAllowed=false`. This lab result does not admit a provider or general
protected production session.

## Verification and remaining work

The [required CI workflow](../.github/workflows/ci.yml) checks build, formatting,
lint, TypeScript/Svelte, tests with coverage, derived counts and production
dependencies. Mutation campaigns are not part of routine CI. Use [development
verification](development/workflow.md) for local commands. Passing CI does not
replace target-platform evidence.

The [roadmap](../ROADMAP.md), [protection plan](roadmap/ai-agent-protection.md) and
linked dated receipts retain remaining discovery, native-platform, ETW, provider
and effectiveness work. No overall detection rate, false-positive rate, startup
guarantee or whole-app overhead measurement is claimed.
