# AEGIS FAQ

## What is AEGIS, and where is the project?

[antropos17/Aegis](https://github.com/antropos17/Aegis) is the canonical repository
for this open-source desktop app for local AI-agent monitoring, security reviews
and explicitly configured action controls. Windows is the primary platform;
macOS and Linux support is experimental. See the [project overview](../README.md).

## What can I inspect?

AEGIS shows recognized agent processes and process trees, changes in configured
sensitive directories and agent configuration paths, TCP endpoints for detected
agent PIDs, resource usage, alerts and audit history. Local security reviews cover
selected projects, skills and profiles, with saved snapshot comparison and offline
report import. Reports can be exported as JSON, CSV, HTML or diagnostic ZIP.
The [capability guide](CAPABILITIES.md) describes coverage and gaps: process
recognition can miss activity, file events can lack attribution, and TCP endpoints
do not reveal encrypted payloads.

## Does default monitoring block agents?

Default monitoring observes and logs. It does not automatically block commands or
contain agents. Terminate, suspend and resume are manual actions whose availability
depends on identity evidence and OS support. Permission labels and endpoint
allowlists do not enforce general OS blocking. See
[alerts and permissions](ALERTS-AND-PERMISSIONS.md).

## How do action controls and MCP routes work?

They require explicit setup and cover only selected actions or configured
connections. Exact-action policies can gate one AEGIS-owned launch; separate
confirmation, Windows Job and AppContainer routes have distinct contracts.
Selected-action MCP tools and validating MCP gateways do not intercept arbitrary
agent tools or traffic outside their routes. Start with
[selected-action setup](README.md#configure-selected-actions) and the
[stdio gateway contract](MCP-STDIO-GATEWAY.md).

## Are Claude Code usage and cost figures a bill?

AEGIS reads measured token subtotals from matching local Claude Code session data.
Unreadable data, bounded reads and other coverage limits can leave them incomplete
or delayed. Dollar amounts use a local rate table and remain estimates; provider
billing adjustments are not inferred. Other agents can show estimated usage.
See [token accounting](TOKEN-ACCOUNTING.md).

## Does monitoring stay local?

Settings, baselines and audit logs stay local, with no usage telemetry or cloud
sync. Endpoint naming sends DNS queries to the configured resolver. Optional
update checks and downloads contact GitHub. Optional Anthropic analysis requires
confirmation and sends activity metadata using your API key, incurring that
service's charges. Paths and endpoints in logs or exports can be sensitive.
See [privacy architecture](../SECURITY.md#privacy-architecture) and
[analysis limits](CAPABILITIES.md#rules-audit-and-reports).

## Where do I get and verify a beta?

Use [GitHub Releases](https://github.com/antropos17/Aegis/releases). Download the
installer, `manifest.json` and `manifest.json.sig` from the same release, then
follow [release verification](RELEASE-VERIFICATION.md). Verification checks origin
and integrity against the signed manifest; it does not establish code safety or
reproducible builds.

## Why can source documentation differ from my installed build?

Source can include changes after an installer's release tag. Read that release's
notes for installed features and the [root README](../README.md#current-development)
for source development. The [readiness record](BETA-READINESS.md) preserves dated,
artifact-specific evidence. A passing record for one package does not qualify a
later installer.
