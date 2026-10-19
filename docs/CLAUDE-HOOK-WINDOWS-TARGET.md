# Windows owned-target IO prerequisite

`sidecar/hook-config-target/` is a framework-only C# library and a separate native
fixture console. It supplies a bounded existing-file handle transaction for
explicitly selected, trusted, disposable local files. It has no production caller,
Node bridge, IPC surface, profile discovery, hook command, installer, private
backup store, ownership authentication, permission modification or provider use.
It does not qualify the complete writer contract or complete W6. The pure planner's
[future writer obligations](CLAUDE-HOOK-PLAN.md#required-future-writer-boundary)
still apply before any profile mutation.

## Supported capability

`TargetLease.Begin(path, out lease)` accepts an existing regular file on a fixed
local NTFS drive with persistent ACL support. The trusted caller supplies an
absolute DOS path with an uppercase drive letter, backslash separators, exact
on-disk spelling and at most 240 UTF-16 code units. Device/UNC/extended paths,
alternate streams, relative components, trailing dots/spaces, control characters,
reserved DOS names and names containing `~` are refused. No missing file is
created. Unsupported identity/filesystem queries are refused.

Every ancestor and the target must be a verified disk handle, without a reparse
point or unsupported attributes. Target directories, read-only/system files,
sparse/compressed/encrypted/offline/cloud files, multiple hard links and
delete-pending files are refused. Supported target attributes are hidden, archive,
normal, temporary and not-content-indexed; ancestor directories additionally allow
directory, system and read-only attributes. These narrow limits intentionally
exclude many otherwise valid Windows files.

Identity is the volume serial number plus the complete 128-bit file ID returned
by `GetFileInformationByHandleEx(FileIdInfo)`. It is never inferred from a PID,
timestamp, path or content hash. The initial read occurs under a temporary
read-sharing guard; a separate original read handle remains open through review
with read/write/delete sharing. This keeps the original object alive while
permitting normal external content edits and target replacement during review.
Retaining the handle prevents treating a subsequently reused file ID as the old
object. Snapshot bytes are bounded to 256 KiB and copied for the private caller.

Ancestor handles remain open without delete sharing throughout review. They bind
the reviewed directory chain and prevent ordinary ancestor rename/replacement.
Additional directory read guards exclude ordinary directory write/delete opens
during snapshot and commit. The final normalized handle paths must equal the
selected paths exactly. Symlink/junction traversal is rejected at every component;
an observed parent/path substitution is refused.

## Compare, write and outcomes

`CompareAndWrite(expectedIdentity, expectedBefore, after)` accepts only the lease's
identity and exact captured before bytes. The after bytes are privately copied and
bounded to 256 KiB. Invalid input leaves the lease available for a valid attempt.
A valid attempt consumes it, including a refused attempt. Dispose is idempotent
and closes all owned handles without restoring bytes.

The commit uses `OPEN_EXISTING` with read/write access and `FILE_SHARE_READ`.
Windows sharing compatibility rejects an already-open writer/deleter, even if
that writer originally allowed sharing. The guard also refuses subsequent normal
write/delete opens. The original object identity and exact current bytes are
checked while this guard is held. An identical-content replacement is stale
because its file identity differs. Stale comparison performs no content write.

The library writes in place through that same verified handle, sets the exact
length, flushes to disk, restores ordinary file attributes, flushes again and
reads back the complete after bytes through the guarded handle. It verifies
identity, creation time and attributes before releasing the guard. The original
file object retains its existing owner, group and ACL; the code contains no
security-descriptor setter or privilege/permission change. Local fixtures verify
the owner/group/DACL descriptor and creation time after the commit guard closes.
Last-write and change times retain native modification signaling so consumers can
notice the edit. Last-access time follows normal OS reads. Timestamps are never
restored to conceal a successful content change.

| Fixed code | Meaning |
| --- | --- |
| `Ready` | Private lease and bounded snapshot captured. |
| `Written` | Exact after bytes verified under the guard. |
| `Stale` | Different original object or exact current bytes; no content write. |
| `Refused` | Unsupported/contended/failed operation before possible mutation. |
| `InvalidInput` | Unsupported selection or inconsistent/oversize commit inputs. |
| `RetainedUnknown` | Mutation may have occurred; no automatic rollback. |
| `Closed` | Capability was disposed or an earlier valid attempt consumed it. |

The possible-mutation flag is set before the first write call. Write, truncate,
flush, metadata or readback failure after that point returns `RetainedUnknown`.
That state is sticky. It never becomes `Stale` and never triggers unconditional
whole-file restoration. Private snapshots, paths and identities remain sensitive;
ordinary outcomes contain no arbitrary errors, paths or file bytes.

## Limits and races

This is an in-place transaction with respect to cooperating Windows file-handle
write/delete access. It is not an atomic file replacement or a crash-safe database
transaction. A read-sharing consumer can observe intermediate bytes; readers are
not isolated. A crash, power loss or interruption can leave partial bytes, and no
runtime result can be returned after process death. A successful result describes
the guarded readback moment; later external edits remain possible.

Sharing does not lock every metadata right. Attribute-only opens, security
descriptor changes, reparse manipulation through attribute rights, hostile code
in the same process, privileged/kernel/raw-volume access and unqualified filter
drivers are outside the supported concurrency model. The caller must provide a
trusted owned target and directory environment without such concurrent actors.
Observed reparse/link/identity changes are refused before writing or become
`RetainedUnknown` after possible mutation. The API does not infer ownership or
prove that no unobservable hostile metadata operation occurred. No caller should
turn this evidence into a production profile-writer authorization.

Remote/mapped network filesystems, ReFS/FAT, cloud synchronization, reparse
providers and arbitrary existing memory mappings are not qualified. Ordinary
path-based Node read-then-write calls do not acquire this guard and are not an
equivalent implementation. Native private-storage/backup qualification, durable
recovery and a separately reviewed integration remain prerequisites.

## Native fixtures and API basis

The separate `fixtures/HookConfigTarget.Fixtures.csproj` targets
`net10.0-windows`, uses no external packages and requires an explicit new
`X:\tmp\...\hook-config-target-fixture-<suffix>` directory. Its parent must already
exist and contain no reparse ancestors. The fixture creates only owned inert
children and disposable files, uses five-second child deadlines, and never reads
a real profile. Build output, CLI home, caches, TEMP/TMP and bounded logs belong
in a spacious task directory. Use disabled compiler/server reuse for local runs.

The tests exercise native layouts, exact and zero/max-size writes, normal edit
staleness, identical-content replacement, an already-open child writer, child
write/delete exclusion during the real guard, parent rename exclusion, invalid
and oversize inputs, missing/read-only files, hard links before and after review,
file/directory symlinks when permitted, actual postwrite faults, actual guarded
readback corruption and handle disposal. A lack of symlink-creation privilege is
reported as an explicit qualification gap. Source-copy assertion mutants must be
recorded separately from the final unmodified fixture result.

Cleanup deletes only exact registered owned entries, never follows reparse
points, never recurses into unknown directories and preserves locked/unknown
entries. Deliberate symlinks and their enclosing fixture directory remain for
review. Private diagnostics have a seven-day review policy; automatic deletion
is not installed. Preserve compact receipts and source hashes. Qualification is
limited to the OS/runtime/filesystem and immutable source recorded in that packet.

The native declarations follow Microsoft's [CreateFile sharing and open flags](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew),
[file information classes](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ne-minwinbase-file_info_by_handle_class),
[128-bit identity layout](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info),
[standard information layout](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_standard_info),
[basic information layout](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info),
[metadata setter](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle),
[handle-derived volume information](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationbyhandlew)
and [.NET RandomAccess](https://learn.microsoft.com/en-us/dotnet/api/system.io.randomaccess?view=net-10.0).
The [reparse operation access rules](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165)
explain why share modes alone are not a complete metadata lock.
