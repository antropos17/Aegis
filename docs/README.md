# AEGIS documentation

The [project overview](../README.md) explains installation, capabilities and limits.
Documentation here describes the current source tree. For an installed build,
check its [release tag](https://github.com/antropos17/Aegis/releases).

## Use the desktop

| Task | Guide |
| --- | --- |
| Find a task or understand a result | [Guided Observatory workflows](OBSERVATORY-GUIDED-WORKFLOWS.md) |
| Review local files and saved snapshots | [Local security workspace](LOCAL-SECURITY-UI.md) |
| Check a selected action or action catalog | [Action control workspace](ACTION-COVERAGE-UI.md) |
| Verify a downloaded installer | [Release verification](RELEASE-VERIFICATION.md) |
| Understand privacy or report a vulnerability | [Security policy](../SECURITY.md) |

## Configure selected actions

These opt-in routes need explicit setup. They do not intercept every agent command
or provide OS isolation. An action catalog contains executable actions; the
desktop's agent catalog contains recognition signatures.

| Capability | Contract |
| --- | --- |
| Exact action policy and CLI execution | [Execution](ACTION-EXECUTION.md) |
| Fresh approval for one launch | [Terminal confirmation](ACTION-CONFIRMATION.md) |
| Connect one selected action via MCP | [Selected-action MCP](ACTION-MCP.md) |
| Connect several selected actions | [MCP action catalog](ACTION-MCP-CATALOG.md) |
| Require approval in an operator terminal | [MCP terminal review](ACTION-MCP-REVIEW.md) |
| Generate an explicit client configuration | [MCP configuration](ACTION-MCP-CONFIG.md) |
| Check selected files without executing | [Route check](ACTION-ROUTE-CHECK.md) and [catalog preflight](ACTION-MCP-CATALOG.md) |
| Inspect one connection's counters | [MCP status](ACTION-MCP-STATUS.md) |
| Observe a running route and coverage loss in desktop | [Live route observation](ACTION-LIVE-OBSERVATION.md) |

## Understand the evidence

- [Architecture](../ARCHITECTURE.md) and [current module inventory](../memory-bank/architecture.md).
- [Project inventory](PROJECT-INVENTORY.md) explains fingerprint scope and privacy.
- [AI-agent protection roadmap](roadmap/ai-agent-protection.md) separates implemented slices from planned coverage.
- [Development roadmap](../ROADMAP.md) and [sensor health](roadmap/sensor-health-degraded.md) track remaining work.
- [Dated correctness audit](current-state/CORRECTNESS-AUDIT.md) and [benchmark records](bench/) provide historical evidence; check their dates.

## Contribute

The [GitHub presentation audit](GITHUB-PRESENTATION-AUDIT.md) records the dated
documentation/link review and its remaining verification limits.

[Contribution workflow](../CONTRIBUTING.md), [development reference](DEVELOPMENT.md),
[verification workflow](development/workflow.md), [code of conduct](../CODE_OF_CONDUCT.md),
[bug reports](https://github.com/antropos17/Aegis/issues/new?template=01-bug-report.yml)
and [feature requests](https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml).
