using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// One fixed ETW name has one protected, bounded write-ahead reservation. Never
// accept a journal path, session name, GUID or cleanup target from normal input.
internal sealed class FileDurableJournal : IDisposable
{
    internal const string Key = @"SOFTWARE\AEGIS.EtwFileRecovery.v1";
    private const string Value = "Reservation";
    private const string Sddl = "O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)";
    private const uint Rights = 0x2011b; // read/control + set value + 64-bit view; no WRITE_DAC/OWNER.
    private readonly Mutex gate;
    private readonly SafeRegistryHandle key;
    [StructLayout(LayoutKind.Sequential)] private struct Attributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegOpenKeyEx(IntPtr root, string name, uint options, uint rights, out SafeRegistryHandle key);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegCreateKeyEx(IntPtr root, string name, uint reserved, string? cls, uint options,
        uint rights, ref Attributes attributes, out SafeRegistryHandle key, out uint disposition);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegQueryValueEx(SafeRegistryHandle key, string name, IntPtr reserved, out uint type, byte[]? data, ref uint size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegSetValueEx(SafeRegistryHandle key, string name, uint reserved, uint type, byte[] data, uint size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegDeleteValue(SafeRegistryHandle key, string name);
    [DllImport("advapi32.dll")] private static extern int RegFlushKey(SafeRegistryHandle key);
    [DllImport("advapi32.dll")] private static extern int RegGetKeySecurity(SafeRegistryHandle key, uint flags, byte[]? descriptor, ref uint length);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private FileDurableJournal()
    {
        if (!Security.Current().Elevated) throw new UnauthorizedAccessException();
        gate = new(false, @"Global\AEGIS.EtwFileRecovery.v1");
        bool acquired;
        try { acquired = gate.WaitOne(TimeSpan.FromSeconds(8)); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) { gate.Dispose(); throw new TimeoutException(); }
        try
        {
            IntPtr machine = new(unchecked((long)0xffffffff80000002));
            int status = RegOpenKeyEx(machine, Key, 8, Rights, out var opened); // OPEN_LINK: never resolve a registry link.
            if (status == 2)
            {
                opened.Dispose();
                if (!ConvertStringSecurityDescriptorToSecurityDescriptor(Sddl, 1, out var descriptor, out _)) throw new Win32Exception();
                try
                {
                    var attributes = new Attributes { Length = Marshal.SizeOf<Attributes>(), Descriptor = descriptor };
                    status = RegCreateKeyEx(machine, Key, 0, null, 0, Rights, ref attributes, out opened, out _);
                }
                finally { LocalFree(descriptor); }
            }
            if (status != 0) { opened.Dispose(); throw new Win32Exception(status); }
            key = opened;
            try { Verify(); } catch { key.Dispose(); throw; }
        }
        catch { gate.ReleaseMutex(); gate.Dispose(); throw; }
    }

    internal static bool SafeDescriptor(byte[] bytes)
    {
        var descriptor = new RawSecurityDescriptor(bytes, 0);
        if (descriptor.Owner?.Value is not ("S-1-5-32-544" or "S-1-5-18") ||
            !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected) || descriptor.DiscretionaryAcl?.Count != 2) return false;
        var sids = new HashSet<string>();
        foreach (GenericAce entry in descriptor.DiscretionaryAcl)
        {
            if (entry is not CommonAce ace || ace.IsCallback || ace.AceQualifier != AceQualifier.AccessAllowed ||
                ace.AceFlags != AceFlags.None || ace.AccessMask != 0xf003f ||
                ace.SecurityIdentifier.Value is not ("S-1-5-18" or "S-1-5-32-544")) return false;
            sids.Add(ace.SecurityIdentifier.Value);
        }
        return sids.Count == 2;
    }

    private void Verify()
    {
        uint size = 0; int status = RegGetKeySecurity(key, 5, null, ref size);
        if (status != 122 || size is 0 or > 4096) throw new UnauthorizedAccessException();
        var bytes = new byte[size];
        if (RegGetKeySecurity(key, 5, bytes, ref size) != 0 || !SafeDescriptor(bytes)) throw new UnauthorizedAccessException();
        // No subkeys or extra values are part of this schema (also rejects registry links).
        using var borrowed = new SafeRegistryHandle(key.DangerousGetHandle(), false);
        using var view = Microsoft.Win32.RegistryKey.FromHandle(borrowed);
        if (view.SubKeyCount != 0 || view.ValueCount > 1 || view.GetValueNames().Any(name => name != Value)) throw new InvalidDataException();
    }

    private FileDurableLease? Read()
    {
        uint size = 0; int status = RegQueryValueEx(key, Value, IntPtr.Zero, out uint type, null, ref size);
        if (status == 2) return null;
        if (status != 0 || type != 3 || size is 0 or > 8192) throw new InvalidDataException();
        var bytes = new byte[size]; uint original = size;
        if (RegQueryValueEx(key, Value, IntPtr.Zero, out type, bytes, ref size) != 0 || type != 3 || size != original) throw new InvalidDataException();
        return FileDurableRecovery.Parse(bytes);
    }

    internal static FileDurableSummary Reserve(FileDurableLease lease, bool denialCheck = false)
    {
        FileDurableRecovery.Validate(lease);
        var self = Security.Current();
        if (!FileDurableRecovery.SameScope(lease, self) || lease.peers[5].pid != self.Pid || lease.peers[5].birth != self.Birth.ToString())
            throw new UnauthorizedAccessException();
        using var journal = new FileDurableJournal();
        var old = journal.Read(); int recovered = 0; uint? denied = null;
        bool? previousSameScope = old == null ? null : FileDurableRecovery.SameScope(old, self);
        if (old != null)
        {
            if (!FileDurableRecovery.SameScope(old, self))
            {
                if (!FileDurableRecovery.Retirable(old, FileTrace.Lookup().Stats.Status, FileDurableRecovery.Gone))
                    throw new UnauthorizedAccessException();
            }
            else
            {
                if (denialCheck)
                {
                    if (!old.peers.All(peer => FileDurableRecovery.Gone(peer) == true)) throw new IOException();
                    var probe = FileRecoveryAccess.RestrictedProbe(() => FileTrace.RecoverReservation(old.guid));
                    if (!FileRecoveryAccess.NeedsConsent(probe)) throw new IOException();
                    denied = 5; // Existing granted token restored; no policy or permission change.
                }
                var result = FileDurableRecovery.Recover(old, FileDurableRecovery.Gone);
                if (!result.stopped || !result.absent) throw new IOException();
            }
            if (FileTrace.Lookup().Stats.Status != 4201) throw new IOException();
            recovered = 1;
        }
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(lease);
        if (bytes.Length > 8192) throw new InvalidDataException();
        int status = RegSetValueEx(journal.key, Value, 0, 3, bytes, (uint)bytes.Length);
        if (status != 0) throw new Win32Exception(status);
        status = RegFlushKey(journal.key); // Durable before the reserved ACK allows StartTrace.
        if (status != 0) throw new Win32Exception(status);
        return new(recovered, denied, true, null, FileDurableRecovery.Digest(lease),
            old == null ? null : FileDurableRecovery.Digest(old), previousSameScope);
    }

    internal static void Retire(string reservation)
    {
        using var journal = new FileDurableJournal();
        var lease = journal.Read();
        if (lease == null || lease.guid != reservation || !FileDurableRecovery.SameScope(lease, Security.Current()) ||
            FileTrace.Lookup().Stats.Status != 4201) return;
        int status = RegDeleteValue(journal.key, Value);
        if (status != 0) throw new Win32Exception(status);
        status = RegFlushKey(journal.key);
        if (status != 0) throw new Win32Exception(status);
    }

    internal static bool NormalWriteDenied()
    {
        if (Security.Current().Elevated) return false;
        int status = RegOpenKeyEx(new IntPtr(unchecked((long)0xffffffff80000002)), Key, 8, 0x102, out var handle);
        using (handle) return status == 5;
    }
    public void Dispose() { key.Dispose(); gate.ReleaseMutex(); gate.Dispose(); }
}
