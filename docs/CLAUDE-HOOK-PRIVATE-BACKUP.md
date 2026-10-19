# Private Windows hook backup prerequisite

`sidecar/hook-private-backup/` is an independently callable, framework-only
`net10.0-windows` library and an owned-file fixture console. It provides a
private backup storage prerequisite for the
[owned hook writer](CLAUDE-HOOK-WRITER.md). A production caller, Node/native
bridge, target-file writer, profile discovery, installation, IPC, UI and provider
qualification remain separate work. This component does not establish full W6,
hook observation or blocking.

## Contract and ownership

The trusted in-process owner calls
`PrivateBackupStore.TryOpen(explicitRoot, createFresh, out store)`. A fresh store
requires a new leaf inside an existing parent. There is no default path or
automatic parent creation. `createFresh: false` validates an existing private
root and inventories retained files; it does not import references, decrypt
orphans, inspect manifests or authenticate restoration ownership.

`Retain(bytes, manifestUtf8, out reference)` accepts arbitrary bytes up to
256 KiB and an exact, strictly valid UTF-8 manifest up to 16 KiB. Empty arrays,
binary bytes, Unicode and UTF-8 BOM bytes are preserved. The returned reference
is an empty, sealed object valid only in its issuing live store instance.
`Read(reference, out payload)` returns independent exact copies only after
identity, ciphertext and plaintext integrity checks. Null, fabricated, foreign
and previous-instance references are refused. There is no public path-based
record lookup, reference import, overwrite, deletion, restore or retention purge.

The hook writer must continue independently holding its expected original-byte
and manifest digests. The store's private digests cannot establish the writer's
ownership, and an on-disk manifest cannot grant restoration authority after
restart. A separate, reviewed adapter would need to preserve these boundaries
when translating the writer's manifest into exact UTF-8 bytes.

Public outcomes are fixed `BackupStatus` values. The library emits no logs or
raw exceptions. It never includes storage paths, account identifiers, ACL
descriptors, payload bytes or manifests in statuses or reference formatting.
The payload is deliberately private data returned to the trusted caller, which
owns its subsequent use and memory clearing.

## Storage and integrity

The supported scope is Windows on a local fixed NTFS volume with persistent
ACLs. Roots must be explicit ordinary DOS paths of at most 180 characters with
ASCII path components. UNC/network paths, relative and device namespaces,
alternate-stream paths, dot traversal, trailing-dot/space ambiguity, reserved
device names and short aliases are refused. Every ancestor and the root is
opened without reparse traversal, checked against its resolved name and pinned
without delete sharing. Root and ancestor identities are rechecked at each
operation. These pins prevent ordinary deletion and namespace replacement while
the store is live. Files must have a single hard link and no reparse attribute.

A fresh root is created with an explicit current-user owner and a protected DACL
containing exactly current-user and SYSTEM FullControl allow entries. Directory
entries are inheritable; each record and the coordination file is created with
its own protected, non-inherited equivalent DACL. The effective owner, protected
flag and complete ACE set are checked through object handles. Existing objects'
ACLs are never modified. A failed creation can leave a private empty or partial
object; the library preserves it for owner review.

The reversible plaintext frame contains a fixed version marker, two bounded
little-endian lengths and the exact bytes and manifest. The complete frame is
protected using Windows current-user DPAPI with `CRYPTPROTECT_UI_FORBIDDEN`, null
prompt, null description and no machine-wide flag or additional process-only
key/entropy. The store exports no keys or credentials. Ciphertext remains
decryptable by that Windows user in a separate process; process loss still
destroys the store's ownership references and independent expected digests.

Records use random 128-bit names and exclusive `CREATE_NEW`. A successful retain
requires a bounded complete write, `Flush(true)`, ciphertext readback, DPAPI
decryption, plaintext digest comparison and final storage checks. Live private
state binds each reference to the file's NTFS identity and separately retained
SHA-256 ciphertext and framed-plaintext digests. Reads open the named file while
denying concurrent writes/deletes, verify its identity and private DACL, read at
most 288 KiB, then verify both digests. Byte-identical replacement files are
refused when their identity differs. DPAPI alone is insufficient for this
application's tamper checks.

## Persistent bounds and failures

Each explicit root has a persistent maximum of eight record files and 2 MiB of
aggregate logical ciphertext bytes, plus one empty coordination file and bounded
filesystem metadata. A per-record 288 KiB ciphertext limit also applies. An
exclusive OS file lock serializes inventory and creation across instances and
processes. Inventory holds file leases while computing and consuming capacity.
The lock file is pinned, checked for the original identity and private DACL,
and never recreated during reopen.

All retained record names count, including zero-byte, partial, orphaned and
previous-process files. Old files are counted without being adopted or
decrypted. Excess capacity, oversized files, unknown names, directories,
unverifiable ACLs, hard links, reparse points and locked/unreadable inventory
cause refusal. No inventory problem triggers deletion or overwriting. Failed
partial creations consume capacity on the next operation or reopen. Lock
contention returns `StorageUnavailable`; there is no retry loop. The trusted
owner must separately review a full or uncertain store. Creating another
explicit root creates another owner-selected quota domain.

The logical byte quota covers this library's bounded default-stream writes.
Uncooperative same-user code, administrators, SYSTEM, storage drivers, malicious
owners and externally added streams/data are outside its security boundary;
DPAPI does not isolate programs running as the same Windows user. The library
does not change parent ACLs or attempt to constrain that user's filesystem
rights. It makes no hardware durability, atomic transaction, sudden-power-loss,
directory-flush, backup portability or permanent availability guarantee. It
does not reconcile uncertain records after a crash or restore any target.

## Focused Windows qualification

The fixture project uses the actual Windows filesystem and DPAPI. Its console
accepts one explicit new disposable fixture root beneath an existing parent.
It never opens a user profile configuration, activates a hook, prompts for
credentials, changes an existing ACL or invokes a provider. A child process
proves DPAPI decryption and persistent quota refusal independently of the first
store's lifetime. An owned directory junction is created through inbox
PowerShell without changing Developer Mode or requesting elevation.

The cases exercise exact binary/Unicode and maximum-size roundtrips, an
independent ACL observation, plaintext absence from ciphertext, unissued and
foreign references, disposal/reopen, corrupt/truncated ciphertext, deleted and
byte-identical substituted records, hard links, root/ancestor rename denial,
root/ancestor/record reparses, persistent count and byte bounds, orphan/partial
records, locked records and coordination, unknown inventory and deterministic
write/flush/readback faults. Full-storage behavior uses an explicit internal
exception seam rather than filling a real disk. The seam cannot be selected
through the public library contract.

Successful fixtures validate the exact owned inventory before removing closed
files and empty directories. They refuse unknown, linked, reparse or locked
cleanup states. The known junction owner removes only its own junction after
proving refusal and target preservation. Failed fixtures retain artifacts and
emit fixed labels without dumping private material. Receipts, source hashes,
build logs and focused mutation results belong in the local qualification
packet; ordinary CI does not run this Windows fixture automatically.

Build the fixture with the installed .NET 10 SDK, a task-owned `--artifacts-path`
and process-local X-drive temporary, CLI-home and NuGet paths. The projects have
no NuGet package dependencies. Use `UseSharedCompilation=false` and disable
MSBuild node reuse in shared qualification environments. Run the resulting
fixture DLL with a new explicit disposable root. Keep operational machine paths
and private receipts outside committed documentation.

## API sources

The Win32 signatures, layouts and behavior were checked against Microsoft Learn:

- [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
  [CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)
  and [DATA_BLOB layout](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/ns-wincrypt-crypt_integer_blob).
- [CreateDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw),
  [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
  and [SECURITY_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/wtypesbase/ns-wtypesbase-security_attributes).
- [GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle),
  [BY_HANDLE_FILE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)
  and [GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew).
- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo),
  [GetSecurityDescriptorLength](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getsecuritydescriptorlength),
  [GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)
  and [GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw).
