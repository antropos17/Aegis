using Microsoft.Win32.SafeHandles;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.HookPrivateBackup;

internal sealed class PrivateRoot : IDisposable
{
    private readonly List<SafeFileHandle> pins = [];
    private readonly List<(string Path, Native.FileIdentity Identity)> identities = [];
    private readonly SafeFileHandle lockPin;
    private readonly Native.FileIdentity lockIdentity;
    internal string PathName { get; }
    internal SecurityIdentifier Owner { get; }
    private const string LockName = ".store.lock";

    internal PrivateRoot(string path, bool fresh)
    {
        using var identity = WindowsIdentity.GetCurrent();
        Owner = identity.User ?? throw new StoreFailure(BackupStatus.Unsupported);
        if (Owner.IsWellKnown(WellKnownSidType.LocalSystemSid)) throw new StoreFailure(BackupStatus.Unsupported);
        PathName = Normalize(path);
        try
        {
            string volume = Path.GetPathRoot(PathName)!;
            var fs = new StringBuilder(64);
            if (Native.GetDriveTypeW(volume) != 3 || !Native.GetVolumeInformationW(volume,
                IntPtr.Zero, 0, out _, out _, out uint flags, fs, 64) ||
                !fs.ToString().Equals("NTFS", StringComparison.Ordinal) || (flags & 8) == 0)
                throw new StoreFailure(BackupStatus.Unsupported);
            string parent = Path.GetDirectoryName(PathName)!;
            Pin(volume, false);
            string current = volume;
            foreach (string component in parent[volume.Length..].Split('\\', StringSplitOptions.RemoveEmptyEntries))
            { current = Path.Combine(current, component); Pin(current, false); }
            if (fresh)
            {
                using var security = new Native.PrivateSecurity(Owner, true);
                if (!Native.CreateDirectoryW(PathName, ref security.Attributes))
                    throw new StoreFailure(BackupStatus.StorageUnavailable);
            }
            Pin(PathName, true);
            string lockPath = Path.Combine(PathName, LockName);
            if (fresh)
            {
                using var security = new Native.PrivateSecurity(Owner, false);
                using var created = security.Create(lockPath, 3);
                Native.Inspect(created, false);
                Native.CheckPrivate(created, false, Owner);
            }
            lockPin = Open(lockPath, Native.ReadControl | 0x80, 3);
            lockIdentity = Native.Inspect(lockPin, false).Identity;
            Native.CheckName(lockPin, lockPath);
            Native.CheckPrivate(lockPin, false, Owner);
            if (Native.Inspect(lockPin, false).Size != 0) throw new StoreFailure(BackupStatus.UnsafeStorage);
        }
        catch { Dispose(); throw; }
    }

    private static string Normalize(string path)
    {
        // Deliberately narrow local DOS namespace; no UNC, ADS, devices, short aliases or dot traversal.
        if (path is null || path.Length > 180 ||
            !Regex.IsMatch(path, @"\A[A-Za-z]:\\[A-Za-z0-9_. -]+(?:\\[A-Za-z0-9_. -]+)*\z"))
            throw new StoreFailure(BackupStatus.Unsupported);
        foreach (string part in path[3..].Split('\\'))
        {
            if (part is "." or ".." || part.EndsWith(' ') || part.EndsWith('.') ||
                Regex.IsMatch(part, @"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)", RegexOptions.IgnoreCase))
                throw new StoreFailure(BackupStatus.Unsupported);
        }
        if (!Path.GetFullPath(path).Equals(path, StringComparison.OrdinalIgnoreCase))
            throw new StoreFailure(BackupStatus.Unsupported);
        return path;
    }

    private void Pin(string path, bool isRoot)
    {
        var handle = Open(path, 0x80 | (isRoot ? Native.ReadControl : 0), 3, true);
        try
        {
            var info = Native.Inspect(handle, true);
            Native.CheckName(handle, path);
            if (isRoot) Native.CheckPrivate(handle, true, Owner);
            pins.Add(handle);
            identities.Add((path, info.Identity));
        }
        catch { handle.Dispose(); throw; }
    }

    internal static SafeFileHandle Open(string path, uint access, uint share, bool directory = false)
    {
        var handle = Native.CreateFileW(path, access, share, IntPtr.Zero, 3,
            Native.OpenReparse | (directory ? Native.BackupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new StoreFailure(BackupStatus.StorageUnavailable); }
        return handle;
    }

    internal void Verify()
    {
        for (int i = 0; i < pins.Count; i++)
        {
            var (path, identity) = identities[i];
            if (Native.Inspect(pins[i], true).Identity != identity)
                throw new StoreFailure(BackupStatus.UnsafeStorage);
            Native.CheckName(pins[i], path);
            using var named = Open(path, 0x80, 3, true);
            if (Native.Inspect(named, true).Identity != identity)
                throw new StoreFailure(BackupStatus.UnsafeStorage);
        }
        Native.CheckPrivate(pins[^1], true, Owner);
        if (Native.Inspect(lockPin, false).Identity != lockIdentity)
            throw new StoreFailure(BackupStatus.UnsafeStorage);
        Native.CheckName(lockPin, Path.Combine(PathName, LockName));
        Native.CheckPrivate(lockPin, false, Owner);
    }

    internal SafeFileHandle AcquireLock()
    {
        Verify();
        var handle = Open(Path.Combine(PathName, LockName), Native.Read | Native.Write | Native.ReadControl, 0);
        try
        {
            var info = Native.Inspect(handle, false);
            if (info.Identity != lockIdentity || info.Size != 0) throw new StoreFailure(BackupStatus.UnsafeStorage);
            Native.CheckPrivate(handle, false, Owner);
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    // Inventory leases prevent ordinary concurrent changes while the persistent quota is computed and used.
    internal Inventory ReadInventory()
    {
        var inventory = new Inventory();
        try
        {
            int entries = 0;
            foreach (string path in Directory.EnumerateFileSystemEntries(PathName))
            {
                if (++entries > PrivateBackupStore.MaxRecords + 1) throw new StoreFailure(BackupStatus.Capacity);
                string name = Path.GetFileName(path);
                if (name == LockName) continue;
                if (!Regex.IsMatch(name, @"\A[a-f0-9]{32}\.rec\z"))
                    throw new StoreFailure(BackupStatus.UnsafeStorage);
                var handle = Open(path, Native.Read | Native.ReadControl, 1);
                inventory.Handles.Add(handle);
                var info = Native.Inspect(handle, false);
                Native.CheckName(handle, path);
                Native.CheckPrivate(handle, false, Owner);
                if (info.Size > PrivateBackupStore.MaxCiphertext) throw new StoreFailure(BackupStatus.Capacity);
                inventory.Count++;
                inventory.Bytes += info.Size;
                if (inventory.Bytes > PrivateBackupStore.MaxStoredBytes) throw new StoreFailure(BackupStatus.Capacity);
            }
            return inventory;
        }
        catch { inventory.Dispose(); throw; }
    }

    internal sealed class Inventory : IDisposable
    {
        internal List<SafeFileHandle> Handles { get; } = [];
        internal int Count;
        internal long Bytes;
        public void Dispose() { foreach (var handle in Handles) handle.Dispose(); }
    }

    public void Dispose()
    {
        lockPin?.Dispose();
        for (int i = pins.Count - 1; i >= 0; i--) pins[i].Dispose();
        pins.Clear();
    }
}
