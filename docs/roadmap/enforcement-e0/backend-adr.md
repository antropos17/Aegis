# E0 ADR: native Protected Session backend

Status: proposed; awaiting actual Astra A0. Date: 2026-09-28.
Source baseline: `52fc21f1de58d78eefcba6ef038b651d08cdb421`.

## Proposed decision

Extend the existing AEGIS C# native ownership implementation into a **separate
session helper**, with a dedicated low-privilege Windows principal and a new
long-running lifecycle. Preserve the existing short AppContainer and Job routes.
Reuse exact policy, binding, approval, durable grants and redacted receipts.
The new session helper is a proposal; it supplies no containment yet.

Compare against one pinned alternative: Anthropic Sandbox Runtime
`ddbeb74711c4097014ef3056791efa83f553116c`, package 0.0.77, native srt-win 0.0.1.
The complete downloaded native source, Cargo lockfile, TS wrapper and Apache-2.0
license accompany the local A0 packet. No upstream binary was installed/run.

| Criterion | Pinned SRT/helper | Separate AEGIS session helper |
| --- | --- | --- |
| Reuse | Separate user, restricted token, private desktop, ACL journal, persistent SID WFP already have source | Preserve tested atomic Job creation, environment isolation, cleanup receipt, current Windows build/distribution path |
| New trusted surface | SRT wrapper/proxies, machine/session stores, account password and ACL migration/recovery | New principal provisioning, restricted token, authenticated protocol, persistent WFP and recovery are substantial unimplemented work |
| Identity scope | Shared srt-sandbox account; session permissions can overlap | One active principal/session initially; trusted ownership lock, no multiuser/concurrent claim |
| Networking | Persistent filters survive engine close in source; permits loopback port range, default 60080-60089 | Persistent SID deny plus exact session-owned broker endpoint; no generic CONNECT/SOCKS tunnel or open port range |
| Crash/cleanup | Raw uninstall removes filters before user deprovisioning (`cli.rs:928`); launcher has suspended creation then Job assignment (`launch.rs:283-309`) | Atomic Job assignment before first execution; retain deny until all owned processes are confirmed stopped, otherwise cleanup-unknown |
| Files | Additive ACEs and host ACL bookkeeping; token has no restricting SIDs (`token.rs:121`) | Need effective allow-only boundary and staged runtime; separate account alone is insufficient for publicly granted resources |
| Packaging | Apache-2.0 plus native/transitive dependency obligations; reviewed build and provenance still needed | Existing MIT source; inbox .NET Framework/C# toolchain; no new language/runtime requirement |
| Normal coding | Native Windows wrapper exists, but this installed Claude and auth are untested under it | Node/Git/Claude executable and DLL access must be qualified against strict boundaries |

The decision favors a boundary matching AEGIS's lifecycle/endpoint/receipt
contracts. It avoids shipping the pinned SRT's raw port-range and uninstall
semantics as AEGIS guarantees. This is an engineering judgment, with greater
implementation effort and regression risk than direct reuse. Astra should reject
or revise it if a narrower, testable reuse adapter is preferable.

SRT source details are design observations, not validated vulnerabilities or
proof that persistent WFP always blocks traffic. The persistent flag appears in
`wfp.rs:470`, and engine open at line 143 uses no dynamic session. Microsoft's
[WFP session lifetime documentation](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmengineopen0)
explains dynamic deletion; real crash/reboot tests remain mandatory.

## Trust and deployment contract for A0

The Electron UI stays unelevated. A narrow, versioned provisioning operation is
invoked only through an explicit administrator action on a disposable Windows
test host. It creates owned identity/helper/state/WFP resources, binds helper
provenance and version, and never changes unrelated home ACLs or firewall rules.
The runtime broker remains outside the sandbox principal's write authority.
If a service is necessary for the selected Windows APIs, it requires a separate
reviewed provisioning operation; no generic elevated command endpoint is allowed.

Trust the host OS and authorized operator. Treat agent, repository/scripts, MCP
servers, tool metadata, claimed PID/SID/session and renderer request data as
untrusted. Verify actual caller token, session owner, policy revision and fresh
process handles. Protocol validity alone never establishes caller authority.
Provisioning/storage paths use safe handles and reject redirection/replacement.
Do not use self-reported identity for OS attribution or approval issuance.

For first qualification allow one protected session. The trusted lock lives
outside agent write authority; clients cannot claim ownership by supplying a SID.
Prepare a bounded independent staged project/runtime, excluding secrets, hooks,
credential helpers, profiles and shared .git indirection. Filesystem read/write
confinement must cover an Everyone-readable canary without granting a whole home.
If strict access and required Windows/runtime DLL compatibility cannot coexist
without broad host ACL changes, the native design remains blocked; no ordinary
fallback or protection badge is permitted. A VM would require a new explicit ADR.

Set token/desktop/Job/filesystem/network bounds before resume. Keep a persistent
SID egress deny while any owned process may survive; do not treat process death,
account deletion or a disconnected UI as proof of zero live tokens. Authenticate
the broker connection and bind its exact endpoint to this session. Port occupancy
and another local service cannot count as broker identity. Test both IP families,
UDP, loopback, descendants, host brokers, helper death and restart in a VM.
Cleanup only removes owned resources after confirmed termination; keep staged
work and restrictions when uncertain. Installer upgrade/uninstall need the same
ordering and must not remove another sandbox product's resources.

## Credentials and compatibility

The user's actual Claude auth is a Pro claude.ai subscription. Preserve that
choice; this plan does not authorize paid API substitution. Host keys/tokens stay
outside the sandbox and must not enter its env/argv/profile, receipts or logs.
A session-scoped broker capability is distinct from an upstream provider secret.
Freeze endpoint/method/path/redirect/body/budget and approval scope at the broker.

[Claude authentication](https://code.claude.com/docs/en/authentication) documents
subscription OAuth. [Gateway documentation](https://code.claude.com/docs/en/llm-gateway)
describes custom routing and distinguishes gateway credentials from saved
subscription login. It does **not** establish compatibility of AEGIS's proposed
secret-free sandbox with that saved login. Current 2.1.263 did accept a local stub
and dummy API credential; this is synthetic evidence only. A2 must establish a
documented, authorized subscription path with no token in the sandbox before
real protected online use. If unavailable, report subscription unsupported and
retain the offline milestone; do not silently change billing or TLS protections.

Current [Claude sandbox docs](https://code.claude.com/docs/en/sandboxing) exclude
native Windows and separate Bash from built-in file-tool permissions. Launch the
whole executable inside the new boundary; hooks only add intent context. Codex
0.157.1 receives its own E8 qualification later, preserving native protections.

## License, provenance and reversibility

AEGIS source is MIT; the pinned SRT root license is Apache-2.0. Only root license
and source tree were inspected; a distributable SRT derivative requires a full
Cargo/JS/transitive LICENSE/NOTICE inventory and retained notices. No dependency,
binary, lockfile or build pipeline changed in E0. Keep upstream source in the
review bundle with its license rather than copying it into production now.
For the proposed helper, include source/compiler/artifact hashes and authenticated
helper-version binding. Artifact signing/provenance and installer recovery remain
E11 work; presence of an exe is not integrity verification.

## Exact next implementation PR, after A0

`feat(protection): define offline session supervisor ownership protocol` (E1).
Introduce bounded CommonJS/JSDoc session messages and separate C# session-owner
entrypoint, keeping short-action APIs intact. Planned files:
`src/main/protected-session-protocol.js`, `sidecar/session/Protocol.cs`,
`sidecar/session/Program.cs`, `tests/main/protected-session-protocol.test.js`,
`tests/main/protected-session-windows.test.js` and a versioned contract document.
It must reject malformed/oversized/unknown protocol, spoofed owner/session,
missing helper/identity and partial setup **before any agent resumes**. Initial
fixtures are offline, disposable and network-denied. Provisioning and native
confinement require a disposable Windows VM/test host first. No existing user
settings or host provisioning are changed by merely importing the protocol.

Gate A0 approves the scoped direction only. Actual identity/IPC/ACL/WFP work
needs scoped Astra review before its merge; A1 qualifies E1-E3 before real-agent
networking, A2 qualifies grants/credentials, A3 external effects/export, A4 release.
E0 maps to B1/B5; E1-E5 to C1/C2/B3; E6/E7 to B2/B4; E8 to B1/B5;
E9-E11 to B5/C3/D1. No existing roadmap item is reset or claimed complete.
