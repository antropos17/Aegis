using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Aegis.HookPrivateBackup;

/// <summary>Fixed public outcomes; no filesystem, account or private payload details.</summary>
public enum BackupStatus { Success, Unsupported, InvalidInput, InvalidReference, StorageUnavailable,
    UnsafeStorage, Capacity, IntegrityFailure, CryptoFailure, Disposed }

internal sealed class StoreFailure(BackupStatus status) : Exception
{
    internal BackupStatus Status { get; } = status;
}

/// <summary>Exact copies returned only to the trusted in-process caller. Caller owns clearing them.</summary>
public sealed record BackupPayload(byte[] Bytes, byte[] ManifestUtf8);

/// <summary>Windows-only prerequisite. No production caller, path-based reads, import, restore or pruning.</summary>
public sealed class PrivateBackupStore : IDisposable
{
    public const int MaxBytes = 256 * 1024, MaxManifest = 16 * 1024, MaxRecords = 8;
    public const int MaxCiphertext = 288 * 1024, MaxStoredBytes = 2 * 1024 * 1024;
    internal const int MaxPlaintext = 12 + MaxBytes + MaxManifest;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly PrivateRoot root;
    private readonly object gate = new();
    private readonly Dictionary<Reference, Record> records = new(ReferenceEqualityComparer.Instance);
    private bool disposed;
    internal Action<FaultPoint>? FaultForFixture { get; set; }
    internal enum FaultPoint { AfterCreate, AfterPartialWrite, BeforeFlush, AfterFlush, BeforeReadback }

    /// <summary>Unimportable process-local capability. Never carries a path or manifest.</summary>
    public sealed class Reference
    {
        internal Reference() { }
        public override string ToString() => "[private-backup-reference]";
    }

    private sealed record Record(string Name, Native.FileIdentity Identity, byte[] CipherDigest, byte[] PlainDigest);
    private PrivateBackupStore(PrivateRoot root) => this.root = root;

    /// <summary>Create requires a new leaf in an existing local NTFS parent. Reopen verifies existing private storage,
    /// counts orphans and adopts no old references or manifests. No ACL is changed on an existing object.</summary>
    public static BackupStatus TryOpen(string explicitRoot, bool createFresh, out PrivateBackupStore? store)
    {
        store = null;
        PrivateRoot? root = null;
        try
        {
            if (!OperatingSystem.IsWindows()) return BackupStatus.Unsupported;
            root = new PrivateRoot(explicitRoot, createFresh);
            using var held = root.AcquireLock();
            using var inventory = root.ReadInventory();
            store = new PrivateBackupStore(root);
            return BackupStatus.Success;
        }
        catch (Exception error) { root?.Dispose(); return Status(error); }
    }

    /// <summary>Retain exact arbitrary bytes and a strict UTF-8 manifest. Any uncertain file remains private and counted.</summary>
    public BackupStatus Retain(byte[] bytes, byte[] manifestUtf8, out Reference? reference)
    {
        reference = null;
        lock (gate)
        {
            if (disposed) return BackupStatus.Disposed;
            byte[]? plain = null;
            try
            {
                if (bytes is null || manifestUtf8 is null || bytes.Length > MaxBytes || manifestUtf8.Length > MaxManifest)
                    return BackupStatus.InvalidInput;
                // Copy first, then validate/hash the owned snapshot rather than a mutable caller array.
                plain = new byte[12 + bytes.Length + manifestUtf8.Length];
                "AHB1"u8.CopyTo(plain);
                BinaryPrimitives.WriteInt32LittleEndian(plain.AsSpan(4), bytes.Length);
                BinaryPrimitives.WriteInt32LittleEndian(plain.AsSpan(8), manifestUtf8.Length);
                bytes.CopyTo(plain, 12);
                manifestUtf8.CopyTo(plain, 12 + bytes.Length);
                StrictUtf8.GetCharCount(plain.AsSpan(12 + bytes.Length));
                byte[] cipher = Dpapi.Transform(plain, true);
                using var held = root.AcquireLock();
                using var inventory = root.ReadInventory();
                if (inventory.Count >= MaxRecords || inventory.Bytes + cipher.Length > MaxStoredBytes)
                    return BackupStatus.Capacity;
                string name = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)) + ".rec";
                string path = Path.Combine(root.PathName, name);
                using var security = new Native.PrivateSecurity(root.Owner, false);
                using var handle = security.Create(path);
                var identity = Native.Inspect(handle, false).Identity;
                Native.CheckName(handle, path);
                Native.CheckPrivate(handle, false, root.Owner);
                FaultForFixture?.Invoke(FaultPoint.AfterCreate);
                // Bounded, non-overwriting creation. No plaintext is ever written to disk.
                using var file = new FileStream(handle, FileAccess.ReadWrite);
                int half = cipher.Length / 2;
                file.Write(cipher.AsSpan(0, half));
                FaultForFixture?.Invoke(FaultPoint.AfterPartialWrite);
                file.Write(cipher.AsSpan(half));
                FaultForFixture?.Invoke(FaultPoint.BeforeFlush);
                file.Flush(true);
                FaultForFixture?.Invoke(FaultPoint.AfterFlush);
                FaultForFixture?.Invoke(FaultPoint.BeforeReadback);
                byte[] readback = ReadBounded(file);
                if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(cipher), SHA256.HashData(readback)))
                    throw new StoreFailure(BackupStatus.IntegrityFailure);
                byte[] verified = VerifyPlain(readback, SHA256.HashData(plain));
                CryptographicOperations.ZeroMemory(verified);
                root.Verify();
                Native.CheckPrivate(handle, false, root.Owner);
                if (Native.Inspect(handle, false).Identity != identity)
                    throw new StoreFailure(BackupStatus.IntegrityFailure);
                var created = new Reference();
                records.Add(created, new Record(name, identity, SHA256.HashData(cipher), SHA256.HashData(plain)));
                reference = created;
                return BackupStatus.Success;
            }
            catch (DecoderFallbackException) { return BackupStatus.InvalidInput; }
            catch (Exception error) { return Status(error); }
            finally { if (plain is not null) CryptographicOperations.ZeroMemory(plain); }
        }
    }

    /// <summary>Read only a reference issued by this live instance; verify identity and independent process digests.</summary>
    public BackupStatus Read(Reference? reference, out BackupPayload? payload)
    {
        payload = null;
        lock (gate)
        {
            if (disposed) return BackupStatus.Disposed;
            if (reference is null || !records.TryGetValue(reference, out var record)) return BackupStatus.InvalidReference;
            byte[]? plain = null;
            try
            {
                using var held = root.AcquireLock();
                using var handle = PrivateRoot.Open(Path.Combine(root.PathName, record.Name), Native.Read | Native.ReadControl, 1);
                var info = Native.Inspect(handle, false);
                if (info.Identity != record.Identity) return BackupStatus.IntegrityFailure;
                Native.CheckName(handle, Path.Combine(root.PathName, record.Name));
                Native.CheckPrivate(handle, false, root.Owner);
                using var file = new FileStream(handle, FileAccess.Read);
                byte[] cipher = ReadBounded(file);
                if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(cipher), record.CipherDigest))
                    return BackupStatus.IntegrityFailure;
                plain = VerifyPlain(cipher, record.PlainDigest);
                int count = BinaryPrimitives.ReadInt32LittleEndian(plain.AsSpan(4));
                payload = new BackupPayload(plain.AsSpan(12, count).ToArray(), plain.AsSpan(12 + count).ToArray());
                return BackupStatus.Success;
            }
            catch (Exception error) { return Status(error); }
            finally { if (plain is not null) CryptographicOperations.ZeroMemory(plain); }
        }
    }

    private static byte[] ReadBounded(FileStream file)
    {
        if (file.Length is <= 0 or > MaxCiphertext) throw new StoreFailure(BackupStatus.IntegrityFailure);
        file.Position = 0;
        byte[] bytes = new byte[(int)file.Length];
        file.ReadExactly(bytes);
        if (file.ReadByte() != -1) throw new StoreFailure(BackupStatus.IntegrityFailure);
        return bytes;
    }

    private static byte[] VerifyPlain(byte[] cipher, byte[] expectedDigest)
    {
        byte[] plain = Dpapi.Transform(cipher, false);
        bool valid = false;
        try
        {
            if (plain.Length < 12 || !plain.AsSpan(0, 4).SequenceEqual("AHB1"u8) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(plain), expectedDigest))
                throw new StoreFailure(BackupStatus.IntegrityFailure);
            int bytes = BinaryPrimitives.ReadInt32LittleEndian(plain.AsSpan(4));
            int manifest = BinaryPrimitives.ReadInt32LittleEndian(plain.AsSpan(8));
            if (bytes < 0 || bytes > MaxBytes || manifest < 0 || manifest > MaxManifest ||
                (long)bytes + manifest + 12 != plain.Length) throw new StoreFailure(BackupStatus.IntegrityFailure);
            StrictUtf8.GetCharCount(plain.AsSpan(12 + bytes));
            valid = true;
            return plain;
        }
        finally { if (!valid) CryptographicOperations.ZeroMemory(plain); }
    }

    private static BackupStatus Status(Exception error) => error is StoreFailure failure ? failure.Status : BackupStatus.StorageUnavailable;

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            records.Clear();
            root.Dispose();
        }
    }
}
