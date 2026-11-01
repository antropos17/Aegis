using System.Text.Json;
using Aegis.HookConfigTarget;
using Aegis.HookPrivateBackup;

namespace Aegis.HookTransaction;

internal sealed class Transaction : IDisposable
{
    private string? target;
    // This ORIGINAL witness survives consumed commit leases and fresh read leases.
    private TargetLease? witness;
    private CreateLease? creation;
    private DeleteLease? deletion;
    private PrivateBackupStore? store;
    private bool readOnly;
    private readonly Dictionary<int, PrivateBackupStore.Reference> references = new();

    internal object Dispatch(JsonElement request, int id)
    {
        string op = Wire.Text(request, "op", 16);
        if (op == "open-delete")
        {
            Wire.Exact(request, "id", "op", "target");
            if (witness is not null || creation is not null || deletion is not null) throw new InvalidDataException();
            string destination = Wire.Text(request, "target", 240);
            if (DeleteLease.Begin(destination, out deletion) != DeleteCode.Ready || deletion is null)
                throw new InvalidDataException();
            return new { id, ok = true, protocol = 1 };
        }
        if (deletion is not null)
        {
            if (op != "delete") throw new InvalidDataException();
            Wire.Exact(request, "id", "op");
            return deletion.Delete() switch
            {
                DeleteCode.Deleted => new { id, ok = true, outcome = "deleted" },
                DeleteCode.Refused => new { id, ok = true, outcome = "refused" },
                DeleteCode.Unknown => new { id, ok = true, outcome = "unknown" },
                _ => throw new InvalidDataException()
            };
        }
        if (op == "open-create")
        {
            Wire.Exact(request, "id", "op", "target", "scope");
            if (witness is not null || creation is not null || deletion is not null) throw new InvalidDataException();
            string destination = Wire.Text(request, "target", 240);
            string scope = Wire.Text(request, "scope", 240);
            if (CreateLease.Begin(destination, scope, out creation) != TargetCode.Ready || creation is null)
                throw new InvalidDataException();
            return new { id, ok = true, protocol = 1 };
        }
        if (creation is not null)
        {
            if (op == "create")
            {
                Wire.Exact(request, "id", "op", "bytes");
                byte[] bytes = Wire.Bytes(request, "bytes", CreateLease.MaxBytes);
                try
                {
                    var outcome = creation.Create(bytes);
                    return outcome switch
                    {
                        TargetCode.Written => new { id, ok = true, outcome = "written" },
                        TargetCode.Refused => new { id, ok = true, outcome = "refused" },
                        TargetCode.RetainedUnknown => new { id, ok = true, outcome = "retained-unknown" },
                        _ => throw new InvalidDataException()
                    };
                }
                finally { Array.Clear(bytes); }
            }
            if (op == "check-created")
            {
                Wire.Exact(request, "id", "op");
                return creation.Check() switch
                {
                    TargetCode.Ready => new { id, ok = true, outcome = "valid" },
                    TargetCode.Stale => new { id, ok = true, outcome = "stale" },
                    _ => throw new InvalidDataException()
                };
            }
            throw new InvalidDataException();
        }
        if (op == "open-read")
        {
            Wire.Exact(request, "id", "op", "target");
            if (witness is not null || creation is not null || deletion is not null) throw new InvalidDataException();
            target = Wire.Text(request, "target", 240);
            if (TargetLease.Begin(target, out witness) != TargetCode.Ready || witness is null)
                throw new InvalidDataException();
            readOnly = true;
            return new { id, ok = true, protocol = 1 };
        }
        if (op == "open")
        {
            Wire.Exact(request, "id", "op", "target", "backupRoot");
            if (witness is not null || creation is not null || deletion is not null) throw new InvalidDataException();
            target = Wire.Text(request, "target", 240);
            string root = Wire.Text(request, "backupRoot", 180);
            if (TargetLease.Begin(target, out witness) != TargetCode.Ready || witness is null ||
                PrivateBackupStore.TryOpen(root, true, out store) != BackupStatus.Success || store is null)
                throw new InvalidDataException();
            return new { id, ok = true, protocol = 1 };
        }
        if (witness is null || target is null || (!readOnly && store is null))
            throw new InvalidDataException();
        if (readOnly && op != "read") throw new InvalidDataException();
        switch (op)
        {
            case "read":
                Wire.Exact(request, "id", "op");
                using (var current = Fresh())
                {
                    if (readOnly && current.Identity != witness.Identity) throw new InvalidDataException();
                    byte[] bytes = current.CopyBeforeBytes();
                    try { return new { id, ok = true, identity = current.Identity, bytes = Convert.ToBase64String(bytes) }; }
                    finally { Array.Clear(bytes); }
                }
            case "retain":
                if (store is null) throw new InvalidDataException();
                Wire.Exact(request, "id", "op", "bytes", "manifest");
                byte[] before = Wire.Bytes(request, "bytes", PrivateBackupStore.MaxBytes);
                byte[] manifest = Wire.Bytes(request, "manifest", PrivateBackupStore.MaxManifest);
                try
                {
                    if (references.Count >= PrivateBackupStore.MaxRecords ||
                        store.Retain(before, manifest, out var reference) != BackupStatus.Success || reference is null)
                        throw new InvalidDataException();
                    int token = references.Count + 1;
                    references.Add(token, reference);
                    return new { id, ok = true, reference = token };
                }
                finally { Array.Clear(before); Array.Clear(manifest); }
            case "backup":
                if (store is null) throw new InvalidDataException();
                Wire.Exact(request, "id", "op", "reference");
                if (!request.GetProperty("reference").TryGetInt32(out int selected) ||
                    !references.TryGetValue(selected, out var issued) ||
                    store.Read(issued, out var payload) != BackupStatus.Success || payload is null)
                    throw new InvalidDataException();
                try { return new { id, ok = true, bytes = Convert.ToBase64String(payload.Bytes), manifest = Convert.ToBase64String(payload.ManifestUtf8) }; }
                finally { Array.Clear(payload.Bytes); Array.Clear(payload.ManifestUtf8); }
            case "commit":
                Wire.Exact(request, "id", "op", "identity", "before", "after");
                string identity = Wire.Text(request, "identity", 256);
                byte[] expected = Wire.Bytes(request, "before", TargetLease.MaxBytes);
                byte[] after = Wire.Bytes(request, "after", TargetLease.MaxBytes);
                try
                {
                    using var lease = Fresh();
                    byte[] current = lease.CopyBeforeBytes();
                    try
                    {
                        if (identity != witness.Identity || lease.Identity != witness.Identity ||
                            !current.AsSpan().SequenceEqual(expected))
                            return new { id, ok = true, outcome = "stale" };
                    }
                    finally { Array.Clear(current); }
                    var result = lease.CompareAndWrite(identity, expected, after);
                    return result switch
                    {
                        TargetCode.Written => new { id, ok = true, outcome = "written" },
                        TargetCode.Stale => new { id, ok = true, outcome = "stale" },
                        _ => throw new InvalidDataException()
                    };
                }
                finally { Array.Clear(expected); Array.Clear(after); }
            default: throw new InvalidDataException();
        }
    }

    private TargetLease Fresh()
    {
        if (TargetLease.Begin(target, out var lease) != TargetCode.Ready || lease is null)
            throw new InvalidDataException();
        return lease;
    }

    public void Dispose() { references.Clear(); store?.Dispose(); witness?.Dispose(); creation?.Dispose(); deletion?.Dispose(); }
}
