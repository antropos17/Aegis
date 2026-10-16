# Dormant Hyper-V socket byte transport

This B05 substep adds a Windows host-side native byte mechanism. It has no
installed-session admission factory, ordinary dispatcher, runtime approval,
service registration or guest commands. `Connect` accepts an internal destination
only; its return value cannot approve a candidate, admit a workload or attest a
guest process. A1-A4 remain UNREVIEWED and launchAllowed=false.

## Address and native boundary

`HvSocketEndpoint` encodes the existing 36-byte Windows SOCKADDR_HV convention:
AF_HYPERV 34, zero reserved bytes, exact VM GUID and fixed product service GUID
`6f958f4e-7436-4a0a-9c04-33f639f6b565`. The service identifier is a new internal
protocol constant. It is unrelated to the fixture's example GUID and provides
no installation or runtime provenance. Zero/wildcard, broadcast, children,
loopback and parent VM routes refuse before opening a socket. There is no service
selector or route fallback.

`HvSocketNative` uses Winsock 2.2, WSASocketW(AF_HYPERV, SOCK_STREAM,
HV_PROTOCOL_RAW), WSA_FLAG_NO_HANDLE_INHERIT, FIONBIO and bounded select waits.
The source targets the existing x64 .NET Framework CSC. It uses pointer-width
socket handles, the Windows x64 fd_set layout and no new dependency. No wrapper
thread masks a blocking syscall. Each instance balances its own Winsock startup
and cleanup and retains one native handle generation.

After connect and before/after each frame, direct getpeername output must have
the exact family, length, reserved bytes, original VM and fixed service. Failure,
unsupported provider behavior or mismatch permanently refuses. No requested or
cached endpoint substitutes for this OS observation. The observation describes
the connected address; it does not identify a guest principal, image, bootstrap,
Job, installed owner or runtime configuration. Actual AF_HYPERV provider behavior
has not been established by the modeled fixtures.

## Finite framing and failure

Frames use the existing BootstrapWire convention: four-byte little-endian length
and 1..4096 opaque payload bytes. The whole connect or frame operation has one
2000 ms monotonic deadline; a connection lasts at most 120000 ms. Readiness wait
slices are at most 20 ms. Progress never renews a deadline. Total sent plus
received payload is at most 32768 bytes, excluding headers. These are mechanism
bounds, not execution permission.

Frame admission immediately refuses contention or reentry and sets the stop
latch. The I/O lock protects budget reservation and one socket generation.
WriteFrame first clones the bounded caller buffer, then reserves its full budget
before partial I/O. A receive reserves the validated body length before allocating
the body. Arithmetic checks remaining capacity before adding. Frames are neither
queued nor resumed/replayed after uncertainty.

Partial sends and receives advance exact offsets. Would-block responses wait
within the original deadline. Zero progress, EOF, malformed size, native failure,
expiry, cancellation or changed peer permanently refuses and closes the local
handle. Owned temporary buffers are cleared. A successfully returned receive
buffer becomes the caller's untrusted data. The byte layer never interprets
release/cancel/result/stopped or validates HMAC/direction/sequence; the existing
GuestChannelWire already defines those protocol behaviors.

Each connection owns one lifetime timer and one cancellation registration.
Cancellation schedules the timer immediately; lifetime expiry also retires an
idle connection without another API call. A busy owner is never closed by the
callback: one guarded callback retries on the same timer until it can acquire
the I/O gate. The final frame-exit fence also observes a signaled stop. This
covers signaling between the final success check and release of the gate.
Retirement disposes the original timer and registration; callbacks contain
failures and retain cleanup uncertainty. The cancellation callback never waits
on the I/O gate, including synchronous invocation during registration.

Cancellation and Dispose signal a stop independently of the I/O lock. Native
destruction is serialized after in-flight calls. Dispose waits at most 2000 ms
for that owner; inability to confirm cleanup reports
`hv-transport-cleanup-unknown`. Native close failure retains the same explicit
uncertainty on subsequent operations, including failed Connect cleanup. No second
close attempt can act on a possibly reused handle. Restoration cannot revive the
connection. A close or timeout does not prove remote receipt, guest Job closure,
VM Off or absence of an already transmitted partial frame.

## Verification contract

The focused Windows test compiles these production files with and without
HV_SOCKET_TEST. Only the test build can substitute modeled native responses and
clock or inspect the stop latch for deterministic race ordering. The production
reflection control confirms that those seams and fixture types are absent.
Compilation failures retain compiler output and fail the suite.

Controls exercise exact address bytes and foreign/unavailable peer observations,
connect readiness/errors, partial I/O and each failure offset, invalid lengths,
caller-buffer mutation, aggregate budget, drip-fed deadlines, cancellation,
reentry, selected overlapping-operation/disposal orderings, idle cancellation,
modeled idle expiry, final-check-to-unlock signaling, explicit cleanup uncertainty
and permanent refusal after apparent restoration. The expiry control advances
the modeled clock and invokes the production timer callback; it does not wait
120 seconds or measure scheduler latency. These controls run
the production frame/state logic. They model native calls and do not measure real
Hyper-V latency, inherited handles, crash durability or hostile runtime identity.
The no-inherit creation flag is supported by source/API review and production
compilation; there is no live child-inheritance experiment in this substep.

The controller retains the actual run receipts. This document does not convert
unexecuted controls or production compilation into live qualification.

## Remaining integration

Service registry provisioning, collision refusal and exact owned uninstall need
a separate installer substep. Actual installed connect requires a distinct
retained runtime/transport admission: original installed owner/caller/registration
and configuration expectations, approved OS/bootstrap/package provenance and
fixed entry point/arguments/limits, an admitted Off-to-runtime transition and B06
bootstrap/runtime proof. Existing candidate metadata and journal replay data
cannot supply that permission.

InstalledVmInspection.CheckCandidateBinding performs a full inspection whose
configuration/storage fences require VM Off. It cannot be used as a running
channel's I/O fence. This patch does not weaken that requirement or introduce a
new binding seam. Missing image choices, provider credentials and a disposable
lab do not block this dormant backend; activation and exact-source native/live
qualification remain pending.

Official contracts: [Hyper-V sockets and addresses](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/make-integration-service),
[getpeername](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-getpeername),
[WSASocketW and no-inherit](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-wsasocketw),
[ioctlsocket](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-ioctlsocket),
[select](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-select),
[closesocket](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-closesocket).
