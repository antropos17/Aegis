# First Protected Session qualification fixtures

Design only, awaiting A0. Existing Job/hook tests executed in E0 are documented
in [evidence.md](evidence.md); none proves a completed Protected Session.

## Test host and rules

Provision a disposable Windows 11 VM/test host only through an explicit
administrator action after A0. Snapshot it before identity/ACL/WFP experiments.
Keep every canary inside the owned fixture root; do not use personal documents,
real secrets/accounts or production receivers. No privileged experiments were
performed on the user's working host during E0. A missing VM means native
qualification not-run. Explicit user/admin authorization is still required for
host provisioning; the plan alone does not supply it.

Each scenario records OS/client/helper/policy versions, scope, fixture/corpus
digest, check command, exit code, independent oracle and cleanup status. Use
fresh OS handles and trusted records for process state. Have an unrestricted
positive control perform the same harmless effect first. A connection timeout,
absent log or exited wrapper alone cannot prove prevention.

## Initial offline sequence

| Case | Fixture and positive control | Independent success oracle |
| --- | --- | --- |
| Useful coding | Tiny JS project with `sum.js` and built-in `node --test`; ordinary copy is edited and its tests pass | Frozen staged diff plus fresh `node --test` exit 0; original bytes unchanged before export |
| Private read | Dummy known bytes in sibling outside staged project; ordinary reader can read | Protected direct CLI, shell, child and grandchild cannot return known bytes; no protected success acknowledgement |
| Public ACL canary | Owned outside file deliberately readable by Everyone in VM; unrestricted reader succeeds | Protected principal/token cannot read it, despite ordinary DACL allowance; demonstrate strict scope rather than different username |
| Host write/delete | Owned outside target and sentinel directory; unrestricted operation changes them | Original bytes/existence stay unchanged; protected denied write/delete paths reported without contents |
| Path indirection | Owned junction/symlink/hardlink/rename/parent-delete/ADS/UNC/device-path fixtures | Either effect stays within scope or operation is explicitly rejected; check oracle after repeated races |
| Descendants | Child/grandchild/detached child, with independent process handles and lifetime sentinels | Scope holds in every process; owner/helper/UI death cannot expand rights; stop confirms all owned members |
| Launch failure | Missing/tampered helper, malformed policy, unavailable identity, UAC refusal, partial setup | No child or sentinel starts; no ordinary launch fallback |
| Tamper/ownership | Fake IPC caller/session/PID/SID, attempted policy/grant/helper modification | Actual caller rejected; trusted bytes and permissions unchanged; cleanup state remains honest |

First useful agent task: launch Claude Code 2.1.263 in the staged tiny project,
change one function, run its tests and stop/retain. First drive deterministic
local stub replies; later repeat with authorized real subscription access only
after A1/A2. Never score a stub task as real cloud compatibility.

## Network, credentials and effects, after the relevant gates

Start local controlled TCP/UDP IPv4/IPv6 receivers, outside the isolated scope,
with byte counters. A positive control sends a random dummy marker and receivers
confirm it. Protected direct IP, DNS, UDP/QUIC, proxy bypass, forbidden loopback,
redirects and preexisting connection must deliver zero forbidden bytes. The
allowed broker route has a separate positive response oracle. Occupy a different
local port and the proposed broker port with an untrusted fixture to test server
authentication. Crash broker/helper/UI while clients connect and retain the SID
deny when termination is unknown. Reboot/upgrade/uninstall are dedicated VM cases.

Use fake provider keys and a local API adapter until A2. Check dummy secret
absence from sandbox env/argv/files/receipts/logs and refused changed endpoints,
methods, redirects, revoked/replayed grants and storage failures. No automatic
external-effect retries with unknown results. Every new MCP side-effect class
and original-project export requires A3 review.

Export uses a frozen reviewed snapshot and fresh destination checks. Fixtures
replace the result/destination, add reparse points, change original bytes, add
Git hooks and simulate disk exhaustion. Only selected reviewed bytes may reach
the owned original fixture; no project hooks/scripts run in the trusted exporter.

## Qualification blockers and budgets

Resolve the observed Windows Job fixture teardown EPERM before A1 resilience
qualification; a passing repeat is retained as separate evidence. Strict file
scope including public grants, runtime/DLL compatibility, all network families,
host-process brokers, private desktop, caller identity and cleanup ordering are
mandatory unknowns. They cannot be replaced by a PASS from design review.

Initially one session, bounded inputs/output/queues/workspace size and execution
time. Numeric product budgets follow measured ordinary-task baseline before
optimization. Diagnostic output is separate from authorization state: cap owned
disposable scratch at 256 MiB per batch and check growth during long runs.
Preserve review/test receipts; review diagnostic retention after 14 days or
64 MiB. Skip locked files and reparse points; no cleanup of unrelated Temp,
databases, grant records, volumes, profiles or retained user workspaces.
