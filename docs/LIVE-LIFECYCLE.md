# Opt-in live lifecycle observation (B1)

Experimental transport/adapter version 1. The CLI runs a finite collector and a
command-hook sender. It does not install hooks, start an agent, modify profiles,
connect to cloud services, bind OS processes or block actions. B1 remains partial.

## Explicit setup

Use Node 24. Generate a fresh 32-byte random bearer for each collector run. It
must be 64 lowercase hexadecimal characters. Keep it in the environment of the
collector and the Claude process whose hooks you explicitly enable; never put it
in command arguments, checked-in settings or a report. Example PowerShell setup:

```powershell
$env:AEGIS_HANDOFF_TOKEN = node -p "require('node:crypto').randomBytes(32).toString('hex')"
$env:AEGIS_HANDOFF_PORT = '42661'
node src/main/main.js --handoff-listen-json claude-code 42661 300
```

This foreground collector expires after 300 seconds. A second shell running the
selected agent must receive the same two environment values through your own
local launch setup. The command does not distribute credentials. Do not save the
token to a file to bridge the shells. Port `0` chooses an available port and reports
it in the ready record; configure the sender with that actual port before use.

To opt in, add these entries to the selected project's existing Claude hook
configuration, preserving other settings. Replace the executable/script paths
with absolute paths appropriate for that machine. This file is an example, not an
installer; no existing configuration is changed by these commands.

```json
{
  "hooks": {
    "SubagentStart": [{ "hooks": [{
      "type": "command",
      "command": "node \"/absolute/path/to/AEGIS/src/main/main.js\" --handoff-send",
      "timeout": 5
    }] }],
    "SubagentStop": [{ "hooks": [{
      "type": "command",
      "command": "node \"/absolute/path/to/AEGIS/src/main/main.js\" --handoff-send",
      "timeout": 5
    }] }]
  }
}
```

The sender reads one JSON document from stdin. It validates the existing bounded
lifecycle shape and transmits only hook_event_name, session_id and agent_id to
`http://127.0.0.1:<port>/v1/lifecycle`. It discards output text, prompts, paths,
tool arguments and unknown fields before opening the socket. It follows no file
references. Raw logical IDs cross the local socket for equality, then become
source-scoped opaque references; they never appear in reports. Do not use direct
provider HTTP hooks with this endpoint: the version/delivery headers belong to
the AEGIS sender protocol, and direct hooks would send the full provider payload.

Remove these hook entries to disable sending. Collector expiry or Ctrl+C closes
intake. Sender failure uses exit 1 and empty stdout/stderr; successful receipt uses
exit 0 and empty stdout/stderr. Neither returns a hook decision or context. The
sender never uses exit 2, interprets response text, retries or follows redirects.
An unavailable collector can cause a provider-visible hook failure; it supplies
no protection. A sender that fails before reaching the receiver cannot update
the receiver's loss count. All reports therefore retain unknown activity coverage.

## Source and delivery boundaries

The listener binds IPv4 loopback only. It accepts a fixed route, JSON content type,
protocol header `X-Aegis-Version: 1`, UUIDv4 `X-Aegis-Delivery` and exact bearer.
Wrong Host, browser Origin, unsupported encoding/version and missing credentials
fail admission with empty error responses. Credentials are compared with a
constant-time comparison after length validation. A successful response is empty
HTTP 204, which acknowledges intake only.

The receiver owns a single source epoch per run. Evidence says `source-reported`,
`sourceAuthentication: bearer-possession`, `processBinding: unbound`,
`phase: observation`, `decision: not-applicable`, `control: not-supported`.
Possessing the bearer does not identify a particular executable or agent version.
A process with the same user's rights may read inherited environment, replace
hook configuration, impersonate the endpoint, forge events, suppress delivery or
exhaust capacity. HTTP is not encrypted; this is not a same-user attacker boundary.
No authentication of the receiver executable is established by the sender.

Delivery IDs are reserved before reading authenticated bodies, including malformed
or interrupted deliveries. Reusing an ID is rejected; new IDs preserve repeated
starts. The sender creates a fresh random ID per invocation and performs no retry.
No content-based deduplication is attempted. A malicious bearer holder can mint
new IDs; resending an event with a new ID is not detected as replay. Use a fresh
bearer after restart: replay detection exists only within one run. No persistent
replay cache or automatic token-reuse detection is claimed.

Receiver ordinals track completed request arrival, not producer execution order.
Concurrent hooks may arrive in a different order. There is no sender sequence
continuity, lost-tail detection, inferred handoff or successful-stop verdict.
Malformed input, rejection, disconnect, observed timeout and bounds leave sticky
loss. Closing with active sockets also marks loss conservatively. A clean deadline
means the selected collection window ended, not that all provider activity arrived.

## Bounds, output and retention

| Resource | Version 1 bound |
| --- | --- |
| Run | CLI 1–900 seconds; no automatic restart |
| Connections | Four simultaneous; 10,000 lifetime; two-second absolute socket deadline |
| Requests | One per socket; 10,000 lifetime; 20 per monotonic one-second bucket |
| HTTP parsing | 4 KiB headers, at most 16 parsed headers; no upgrade/continue path |
| Authenticated bodies | 64 KiB per request; 8 MiB cumulative with at most one arriving chunk of read-ahead before shutdown |
| Receiver | 2,000 accepted events, 2,000 logical identities; existing attempt bounds |
| Delivery IDs | At most 10,000 UUIDs retained in memory, discarded on close |
| Sender | 64 KiB stdin; two seconds for stdin and two seconds for HTTP; no retry |

The byte counter covers authenticated protocol bodies, not all network traffic.
Rejected-header connections are bounded by socket count/deadline and total
connections. Rate rejection closes the request; there is no admission queue.
Any local sender can cause denial of observation by consuming these limits.

Collector stdout is JSONL: one ready record, then one final report with up to
2,000 metadata events and receiver/transport counters. No per-event output queue
is retained. Events remain in memory until final output; process kill/crash loses
that window and produces no final completeness claim. Controlled exit allows
stdout to drain. Exit 0 means no detected intake loss, 2 means detected loss, and
1 means invalid setup/listen failure. These are observation statuses, not verdicts.
The implementation creates no files; caller redirection is caller-owned retention.
Transport rejection totals are diagnostics, and may count multiple symptoms of
one failed connection; they are not a count of lost provider actions.

## Verification and support

The [Claude hook reference](https://code.claude.com/docs/en/hooks#subagentstart)
was reviewed on 2026-09-18 for command-hook input and the two lifecycle event
shapes. Windows Claude 2.1.263 was then run against a local model-response stub
in isolation: its actual SubagentStart/Stop hooks invoked the AEGIS sender and
the collector accepted both. See [the provider fixture](ACTION-POLICY-HOOK.md#verification).
Producer version remains unknown in ordinary reports: this fixture does not
authenticate future senders. The protocol remains AEGIS adapter version 1.

Synthetic tests exercise real loopback HTTP and Node CLI processes: successful
start/stop delivery, pre-socket privacy projection, forged evidence, unauthorized
input, duplicates, invalid versions, size/rate/concurrency/time bounds, interrupted
input, shutdown/restart and occupied ports. Windows is checked locally; Linux is
checked in CI. macOS, interactive approval and cloud-model execution remain unverified. No agent credentials, transcripts or real secret files are used.

Next: continue action/policy mediation beyond the experimental before-only hook. The
[B1 event/policy contract](AGENT-EVENT-CONTRACT.md) and its ACS assessment remain
the completion criteria; live lifecycle telemetry cannot fulfill blocking claims.
