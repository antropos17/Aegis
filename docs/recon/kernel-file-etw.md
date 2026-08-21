# Microsoft-Windows-Kernel-File ETW — static recon

**STATUS: STATIC RECON FROZEN — SAFE TO FREEZE WITH WORDING CHANGES**

**Scope:** source-backed static research only. Provider behavior requiring target-machine
observation stays hardware-gated and is not ratified here.

This artifact freezes two research passes: an original static recon and an adversarial evidence
stress-test of that same report. The stress-test is authoritative wherever it weakens or
contradicts the first pass.

Every statement below carries exactly one evidence label, given by the section it sits in. An
inference is not promoted to a verified fact by prose cleanup. The five labels are
**VERIFIED MANIFEST/API FACT**, **AEGIS DESIGN DECISION**, **NOT FOUND**, **INFERENCE/ANALOGY**
and **HARDWARE-GATED**.

---

## VERIFIED MANIFEST/API FACT

### Manifest items

Each item in this sub-section is scoped to the verified **Windows 10 build 18990
`Microsoft-Windows-Kernel-File` manifest** and to nothing else. It is not a claim about the
manifest registered on any other Windows build.

- Provider GUID is `{edd08927-9cc4-4e65-b970-c2560fb5c289}`.
- Read is event 15; `KERNEL_FILE_KEYWORD_READ` = `0x100`.
- The Read payload contains no pathname. It carries `FileObject` and `FileKey`.
- Read v0 exposes `ThreadId`; Read v1 exposes `IssuingThreadId`.
- Create is event 12 and carries `FileObject` plus `FileName`.
- NameCreate is event 10 and carries `FileKey` plus `FileName`.
- Cleanup 13 and Close 14 exist and carry the relevant pointer-typed fields.
- This manifest contains no provider rundown event.

### API and release items

These are not manifest-derived. They come from official ETW filtering documentation and from
package-registry release data, and they are scoped accordingly.

- Official `EVENT_FILTER_TYPE_PID` semantics scope provider enablement to listed user-mode
  processes, and document limitations for provider registration in kernel-mode drivers.
- Event-ID filtering is applied after event generation. It may reduce recorded or delivered
  volume, but it does not remove provider generation cost.
- `Microsoft.Diagnostics.Tracing.TraceEvent` 3.2.5 (2026-07-17) and
  `Microsoft.O365.Security.Native.ETW` / krabsetw 4.4.9 (2026-05-13) are current releases.
  Package freshness is not feature-parity evidence.

---

## AEGIS DESIGN DECISION

- Path attribution for Read requires correlation outside the Read event itself, using
  path-bearing evidence. The manifest proves the fields, not a complete lifecycle policy or one
  mandatory algorithm.
- `unresolved` is a first-class fail-honest state. A missing path is never fabricated and never
  silently upgraded to resolved evidence.
- AEGIS cannot rely on resolving files already open when the ETW session starts. There is no
  rundown event in the verified manifest; reads remain unresolved unless a later path-bearing
  event happens to rebuild the mapping. This is not a claim that already-open files never
  resolve, nor that no other recovery mechanism exists on current Windows.
- AEGIS must not rely on session-level PID filtering for this GUID until it is reproduced on the
  target Windows system. Machine-wide capture followed by user-mode attribution and filtering is
  the required fallback design, not a verified mandatory property of the provider.
- Applicable ETW loss counters such as `EventsLost` and `RealTimeBuffersLost` are captured and
  exposed when this sensor is implemented. They indicate collection unreliability; they do not
  identify which specific Create, NameCreate, Read or lifecycle event was lost.
- TraceEvent is the preferred and implementation-evidenced option from this recon: it has direct
  evidence here for session APIs, filtering surface, samples and parser behavior.
- krabsetw remains an actively maintained native candidate, but equivalent Kernel-File real-time
  and filter behavior was not established by this recon. The two are not presented as equally
  evidenced.
- ferrisetw is not the preferred candidate. Its evidenced reservations are maintenance maturity
  and weaker implementation evidence for this design. Its `ByPids` issue is not provider-specific
  proof that this provider cannot be consumed correctly.
- `FileObject` and `FileKey` are the manifest-visible correlation fields between Read and
  path-bearing events. Cleanup and Close expose related fields, but lifetime, reuse and required
  eviction semantics for this modern provider were not established.
- `0x190` is spec-consistent with the currently identified path and read events 10, 12 and 15. It
  is not sufficient to claim delivery of Cleanup and Close 13/14, which are FILEIO events
  requiring keyword `0x20` in the verified manifest; an event-ID filter cannot restore an event
  the keyword mask never enabled. A configuration intentionally including FILEIO lifecycle events
  would need that keyword, producing a candidate mask such as `0x1B0` — but neither that mask nor
  the necessity of events 10, 13 and 14 is ratified as the minimal correct configuration. `0x1B0`
  is a candidate, not the canonized answer.
- Collection cost for File-read is not estimated from the callback rate of AEGIS-relevant
  processes.

---

## NOT FOUND

- The authoritative issuer identity for event 15 is not established. The relationship among
  `EVENT_RECORD.EventHeader.ProcessId`, `ThreadId` / `IssuingThreadId`, and possible System /
  PID 4 attribution requires live reproduction. This recon does not state that
  `EventHeader.ProcessId` is the issuer, and does not specify dropping events by that field as a
  proven algorithm.
- The recon did not establish the registration locus or provider-specific PID-filter behavior of
  this GUID.
- No clean independent per-event oracle for Read event 15 was established. Procmon is an
  independent observation column for file activity, but it does not prove that Kernel-File
  emitted event 15. Windows Security 4663 is not a per-event Read oracle.

---

## INFERENCE/ANALOGY

- Legacy NT Kernel Logger FileIo `FileObject`/`FileKey` lifecycle behavior is retained only as a
  labeled analogy, never as proof of Kernel-File behavior.
- The detail that repeated access on one open handle produces a single 4663 is SECONDARY and is
  not independently ratified by this recon.

---

## HARDWARE-GATED

Live-machine ratification items. These are not invitations for further source research; each one
closes only against observation on the target system.

1. Provider-specific `EVENT_FILTER_TYPE_PID` behavior for this GUID.
2. Authoritative event-15 issuer attribution across `EventHeader.ProcessId`, `ThreadId`,
   `IssuingThreadId` and possible PID 4 behavior.
3. The current Windows 11 / 2026 registered manifest: added events, added keywords, any usable
   rundown or capture-state behavior.
4. Whether NameCreate 10 is emitted as the proposed correlation design needs.
5. Whether Cleanup and Close 13/14 are required for correct mapping lifecycle.
6. Actual `FileObject`/`FileKey` lifetime and reuse semantics.
7. Minimal correct keyword plus event-ID enable set.
8. Idle, npm and build event-15 rates.
9. CPU, memory, buffer cost and `EventsLost` / `RealTimeBuffersLost` under load.
10. Fast I/O behavior.
11. mmap and mapped-file page-fault coverage.
12. Home versus Pro differences.
13. Hyper-V guest behavior.
