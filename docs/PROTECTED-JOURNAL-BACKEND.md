# Original-owner live journal backend

This slice adds a production native metadata writer tied to the original installed owner and a protected installer registration. It introduces no ordinary consumer, inspect-owned write, transport route, VM operation, mutation permission or restart recovery. `launchAllowed=false` and enforcement acceptance remain unchanged.

The original [operation record contract](PROTECTED-OPERATION-RECORD.md) remains the data/reducer authority. The journal acknowledgment describes metadata persistence by one live lease. It cannot authorize a provider effect, establish successful mutation settlement, or turn `PrefixOnly` replay into active ownership.

## Original installation association

The installer creates the private fixed `OperationJournal` sibling under the original protected AEGIS parent. A preexisting directory is refused. Each staged epoch receives exactly one empty file named `operations-<installId>-<epoch>-<revision>.jsonl`, created with CREATE_NEW and its intended descriptor. `ProtectedInstallFile.CreateEmptyJournal` captures identity and descriptor from that same creation handle. An uncertain creation remains cleanup-unknown; cleanup never discovers a replacement by pathname.

The immutable `ProtectedSession/registered-journal.json` leaf binds the current installation/revision/epoch/policy digest and selection tuple to a fresh journal generation, original directory volume/file ID and canonical descriptor digest, exact derived basename, and original data-file volume/file ID and descriptor digest. The closed canonical schema is bounded to 2048 UTF-8 bytes. Security digests use SHA-256 of UTF-8 SDDL canonicalized with `RawSecurityDescriptor.GetSddlForm(Owner | Access)` in both the PowerShell installer and C# reader. Matching digests and names do not replace actual protection checks.

The production issuer retains the exact `InstalledOwnerRegistration`, original caller completion, original VM registration and immutable journal registration bytes. It accepts no supplied root, serialized authority, arbitrary stream or authority callback. The runtime opens only the exact registered installer-created zero-length file with an exclusive retained writer; another file ID, nonempty file, malformed header, or disposed/failed lease cannot be adopted or reopened. One original owner permits one issuance attempt.

The original caller-bound Off/configuration/storage preflight is required at initial issuance. Appends recheck the original owner/caller/protected registration record and expected tuple. They make no claim about the current configuration of a running VM and invoke no VM provider operation.

## Live persistence and loss

The issuer writes one bounded canonical header with the original binding, installer journal generation, exact file identity and fresh cryptographic nonce. Installation epoch, selection epoch, runtime session epoch and journal issuance nonce have distinct meanings. None of them is an independent protected restart anchor.

Each append checks the exact retained prefix, EOF, file identity, descriptor, expected sequence/head and production codec/reducer transition before writing. The same held native handle completes positive WriteFile progress, requires a successful FlushFileBuffers call, and verifies exact full readback. Only after final original-authority checks does the lease advance and mint an acknowledgment bound to that exact lease/append result. Failed, zero-progress or uncertain writes, failed flush, bad readback, prefix restoration, reentry and ownership loss permanently fail the lease. Restoring bytes cannot clear that failure.

The synchronization order is original caller completion gate, original owner journal gate, then lease gate. Owner disposal marks ownership closed under the journal gate, then releases that gate before disposing contained registrations that take caller-related locks. Concurrent disposal while cleanup is in progress reports cleanup unconfirmed. This orders local acknowledgment and disposal; it cannot prevent an external process from dying after its last observation. Acknowledgment use still requires the same current live lease.

The initial header is bounded to 2048 bytes. The operation history retains the existing 256 IDs and 1025 frames including reserved revoke, each at most 2048 bytes. The total file limit is 2,101,248 bytes. Actual encoded headers and frames are checked against their bounds; no padding or fixed-size assumption supplies the limit. There is no truncation, suffix repair, automatic retry, rotation or recovery factory.

## Stage, upgrade and cleanup

Administrative ownership retains at most two exact epoch files: current and staged/rollback, at most 4,202,496 bytes in total. Existing upgrade logic requires the original owner idle before staging. Both files may exist during administrative verification; runtime issuance deliberately requires its sole registered data file. Commit retires the exact old original before the next owner may issue. Rollback removes only the newly staged original and preserves the old association.

Every file is associated with `stage.journal` from creation, separately from immutable stage hash rows. Closed collection requires original owner/child closure, original directory/file IDs, descriptor, exact name and bounded reads. Unexpected entries, uncertain ownership and live write sharing refuse collection. A valid-looking header or allowed basename cannot create cleanup ownership. Uninstall removes only those original files, then the verified empty original directory; no recursive namespace deletion is used.

The closure fence is transitive through the same original administrative context. The supported service-start route, `Invoke-InstalledOwnerAttempt` in `scripts/qualification/installed-owner-phase.ps1`, sets that context's `cleanupUnknown` latch before service Start. It clears the latch only after checking the fresh native receipt against the exact original owner/process tuple, images and confirmed owned-child/Job closure. Journal collection checks this same latch and refuses while it is true. A stopped SCM state or absence of a conflicting writer supplies no substitute closure proof. The focused real-file lifecycle negative retains this latch, verifies collection/retirement refusal with unchanged original file ID and bytes, and then models the verified closure boundary before successful retirement; it starts no service.

Before authorized retirement the administrative context retains exact final bytes, hash and original identity in `journalEvidence`, bounded to eight entries. Failed capture or exhausted evidence capacity refuses retirement, with no silent eviction. This is in-memory administrative evidence, lost with the context/process; it supplies no durable archive, audit retention or reboot recovery policy. Verification receipts are retained separately by the verification controller. A future effect-bearing integration must define durable evidence preservation and unresolved-operation reconciliation before treating this cleanup path as sufficient for active operations.

## Verification and limits

The first behavioral RED compiled the production parser but rejected actual bytes from the new PowerShell installer serializer. The parser GREEN accepted those exact serializer outputs. A subsequent iteration failed native fixture compilation and skipped all 37 cases; it supplies no behavioral evidence. Its receipt remains preserved. The following focused iteration passed 37/37 without skips, including:

- Actual PowerShell serializer bytes accepted by the production parser, canonical negatives, and compilation without test-only seams.
- Actual Win32 creation-handle identity, exclusive writer, real chunked/multiple WriteFile calls, FlushFileBuffers and readback, foreign identity/security, nonempty/reopen refusal and sticky loss controls.
- Actual stage writer and journal lifecycle helpers through two-original verification, commit, rollback, closed byte collection and exact cleanup, with descriptor trust modeled explicitly.
- Actual retained process registrations in the synthetic installed-owner disposal regression, plus deterministic local append/owner and caller ordering controls.

Native write/flush/readback failure responses and protected installation authority are modeled where labeled. Chunked native requests demonstrate multiple real calls; they do not demonstrate a native provider returning fewer bytes than requested. The suite launches no service, account operation, VM mutation or provider experiment. It does not qualify the production protected installation environment, hostile privileged replacement, whole-host rollback, abrupt process death, reboot or power-loss persistence. Native flush/readback success does not independently prove directory-entry publication across power loss.

Original-owner/VM/caller compilation and lifecycle neighbors, the production helper build and the normal required CI gates remain separate applicable verification. The backend has no ordinary consumer; installing its source or passing local fixtures does not approve launch or an enforcement milestone.
