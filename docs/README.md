# AEGIS documentation

The [project overview](../README.md) explains installation, capabilities and limits.
Guides describe source features; dated plans and qualification records retain their
original revision and evidence. For an installed build, check its
[release tag](https://github.com/antropos17/Aegis/releases).

Start with the [full capability guide](CAPABILITIES.md) for desktop monitoring,
local reviews, token accounting, selected actions, MCP gateways and experimental
Hyper-V execution. It maps entry points to their coverage limits. The
[root README](../README.md#current-development) summarizes source development;
installed features depend on the release tag. For common questions, see the [FAQ](FAQ.md).

Find current Windows beta installers on [GitHub Releases](https://github.com/antropos17/Aegis/releases).
The [readiness record](BETA-READINESS.md) contains dated, artifact-specific
qualification evidence and limits; those records do not qualify later installers.

## Use the desktop

| Task | Guide |
| --- | --- |
| Find a task or understand a result | [Guided Observatory workflows](OBSERVATORY-GUIDED-WORKFLOWS.md) |
| Understand alerts and saved permissions | [Alerts, review and permissions](ALERTS-AND-PERMISSIONS.md) |
| See the simulated preview from 11 October 2026 | [Observatory screenshots](screenshots/README.md) |
| Review local files and saved snapshots | [Local security workspace](LOCAL-SECURITY-UI.md) |
| Check a selected action or action catalog | [Action control workspace](ACTION-COVERAGE-UI.md) |
| Understand measured token subtotals and estimated costs | [Token accounting](TOKEN-ACCOUNTING.md) |
| Interpret saved audit counts and coverage loss | [Audit counters](AUDIT-COUNTERS.md) |
| Verify a downloaded installer | [Release verification](RELEASE-VERIFICATION.md) |
| Understand privacy or report a vulnerability | [Security policy](../SECURITY.md) |

## Configure selected actions

For fresh approval before one Windows launch with Job-member cleanup, see
[terminal confirmation](ACTION-CONFIRMATION.md). The separate
[Windows AppContainer route](ACTION-APPCONTAINER.md) restricts a reviewed action
in a new retained workspace. Remaining agent integration is tracked in the
[protected-launch plan](roadmap/protected-launch.md).

These opt-in routes need explicit setup. They do not intercept every agent command
automatically. The explicit AppContainer route supplies offline action isolation;
the administrative VM APIs below have separate lab prerequisites. An action catalog contains executable actions; the
desktop's agent catalog contains recognition signatures.

| Capability | Contract |
| --- | --- |
| Exact action policy and CLI execution | [Execution](ACTION-EXECUTION.md) |
| Opt-in Cedar policy for direct execution | [Cedar policy and runtime limits](ACTION-POLICY-CEDAR.md) |
| Offline Windows isolation in a new workspace | [AppContainer launch](ACTION-APPCONTAINER.md) |
| Fresh approval for one launch | [Terminal confirmation](ACTION-CONFIRMATION.md) |
| Connect one selected action via MCP | [Selected-action MCP](ACTION-MCP.md) |
| Connect several selected actions | [MCP action catalog](ACTION-MCP-CATALOG.md) |
| Require approval in an operator terminal | [MCP terminal review](ACTION-MCP-REVIEW.md) |
| Generate an explicit client configuration | [MCP configuration](ACTION-MCP-CONFIG.md) |
| Check selected files without executing | [Route check](ACTION-ROUTE-CHECK.md) and [catalog preflight](ACTION-MCP-CATALOG.md) |
| Inspect one connection's counters | [MCP status](ACTION-MCP-STATUS.md) |
| Observe a running route and coverage loss in desktop | [Live route observation](ACTION-LIVE-OBSERVATION.md) |

## Configure validating MCP gateways

These gateways validate explicitly routed traffic to a selected server. They
have separate contracts from the selected-action tools above.

| Capability | Contract |
| --- | --- |
| Selected stdio server, accepted catalog and exact grants | [stdio gateway](MCP-STDIO-GATEWAY.md) |
| Finite local HTTP/SSE transport | [Loopback HTTP](MCP-HTTP-GATEWAY.md) |
| Explicit CA/name/IP/leaf checks | [Pinned HTTPS](MCP-HTTPS-GATEWAY.md) |
| Expiry, consumption and route/credential/launch binding | [Persistent grants](MCP-DURABLE-GRANTS.md) |
| Explicit known values and listed encodings | [Known-secret policy](MCP-KNOWN-SECRETS.md) |

## Experimental protected Windows guests

| Scope | Contract or evidence |
| --- | --- |
| Original protected association and read-only VM inspection | [Installed registration](roadmap/enforcement-e2/installed-vm-registration.md) |
| Fresh private VM, original disk and admitted image | [Protected creation](roadmap/enforcement-e2/protected-vm-creation.md) |
| Trusted disk hydration, native lifecycle and bounded guest agent | [Administrative guest run](roadmap/enforcement-e2/protected-guest-start.md) |
| Actual native and Windows guest/agent PASS on tested source | [16 October hosted evidence](roadmap/enforcement-e2/protected-guest-hosted-evidence-20261016.md) |
| Fixed Claude scratch traversal and one immediate retry | [Scratch observation](roadmap/enforcement-e2/claude-scratch-observation.md) |

These are elevated repository APIs and disposable-lab controls. Ordinary
installed-caller launch remains disabled, unknown VMMS work has no recovery API,
and independent enforcement acceptance remains open. `launchAllowed=false`.

## Understand the evidence

- [Architecture](../ARCHITECTURE.md) and [current module inventory](../memory-bank/architecture.md).
- [Project inventory](PROJECT-INVENTORY.md) explains fingerprint scope and privacy.
- [AI-agent protection roadmap](roadmap/ai-agent-protection.md) separates implemented slices from planned coverage.
- [Development roadmap](../ROADMAP.md) and [sensor health](roadmap/sensor-health-degraded.md) track remaining work.
- [Dated correctness audit](current-state/CORRECTNESS-AUDIT.md) and [benchmark records](bench/) provide historical evidence; check their dates.

## Contribute

The [GitHub presentation audit](GITHUB-PRESENTATION-AUDIT.md) records the dated
documentation/link review and its remaining verification limits.

[Current development context](development/current-context.md),
[contribution workflow](../CONTRIBUTING.md), [development reference](DEVELOPMENT.md),
[verification workflow](development/workflow.md), [code of conduct](../CODE_OF_CONDUCT.md),
[bug reports](https://github.com/antropos17/Aegis/issues/new?template=01-bug-report.yml)
and [feature requests](https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml).
