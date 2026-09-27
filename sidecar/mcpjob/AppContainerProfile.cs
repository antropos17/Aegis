using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;

// Holds one private profile journal lock through launch, Job cleanup and profile deletion.
// A crash releases the lock; the next launch retries only bounded, owned profile markers.
internal sealed class AppContainerProfile : IDisposable
{
    private const int MaxPending = 16;
    private static readonly Regex MarkerName = new Regex(
        @"^aegis-action-[a-f0-9]{32}\.profile$", RegexOptions.CultureInvariant);
    private readonly FileStream journalLock;
    private readonly List<IntPtr> pinnedDirectories;
    private readonly string marker;
    private readonly string name;
    private bool ownsProfile = true;
    internal IntPtr Sid { get; private set; }
    internal bool CleanupConfirmed { get; private set; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(string name, string display,
        string description, IntPtr capabilities, int count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll")] private static extern IntPtr FreeSid(IntPtr sid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string path, uint access, uint sharing,
        IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(IntPtr handle, out FILE_INFORMATION info);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME { public uint low, high; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_INFORMATION
    {
        public uint attributes;
        public FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }

    private AppContainerProfile(FileStream heldLock, List<IntPtr> pins,
        string markerPath, string profileName)
    {
        journalLock = heldLock;
        pinnedDirectories = pins;
        marker = markerPath;
        name = profileName;
    }

    internal sealed class WorkspaceJournalLease : IDisposable
    {
        internal readonly string DirectoryPath;
        private readonly FileStream heldLock;
        private readonly List<IntPtr> pins;
        internal WorkspaceJournalLease(string directory, FileStream held, List<IntPtr> directories)
        { DirectoryPath = directory; heldLock = held; pins = directories; }
        public void Dispose()
        {
            heldLock.Dispose();
            for (int i = pins.Count - 1; i >= 0; i--) CloseHandle(pins[i]);
            pins.Clear();
        }
    }

    // Uses the same owner/SYSTEM-only directory and non-reparse ancestor checks
    // as the profile journal, but a separate lock and bounded record namespace.
    internal static WorkspaceJournalLease OpenWorkspaceJournal(bool create)
    {
#if APPCONTAINER_TEST
        string local = AppDomain.CurrentDomain.BaseDirectory;
#else
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
#endif
        if (string.IsNullOrEmpty(local) || !Path.IsPathRooted(local))
            throw new InvalidOperationException("workspace-journal-unavailable");
        string ownerRoot = Path.Combine(local, "AEGIS");
        string journal = Path.Combine(ownerRoot, "AppContainerWorkspaceJournal");
        List<IntPtr> pins = new List<IntPtr>();
        FileStream held = null;
        try
        {
            PinAncestors(local, pins);
            EnsurePrivateDirectory(ownerRoot, pins, create);
            EnsurePrivateDirectory(journal, pins, create);
            string lockPath = Path.Combine(journal, ".lock");
            held = new FileStream(lockPath, create ? FileMode.OpenOrCreate : FileMode.Open,
                FileAccess.ReadWrite,
                FileShare.None);
            ValidatePrivateJournalFile(lockPath);
            return new WorkspaceJournalLease(journal, held, pins);
        }
        catch
        {
            if (held != null) held.Dispose();
            for (int i = pins.Count - 1; i >= 0; i--) CloseHandle(pins[i]);
            throw;
        }
    }

    internal static void ValidatePrivateJournalFile(string selected)
    {
        FileAttributes attributes = File.GetAttributes(selected);
        if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
            throw new InvalidOperationException("workspace-journal-file-unsafe");
        FileSecurity security = File.GetAccessControl(selected);
        SecurityIdentifier owner = WindowsIdentity.GetCurrent().User;
        if (!owner.Equals(security.GetOwner(typeof(SecurityIdentifier))))
            throw new InvalidOperationException("workspace-journal-file-owner");
        SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        AuthorizationRuleCollection rules = security.GetAccessRules(true, true,
            typeof(SecurityIdentifier));
        foreach (FileSystemAccessRule rule in rules)
        {
            SecurityIdentifier sid = (SecurityIdentifier)rule.IdentityReference;
            if (rule.AccessControlType != AccessControlType.Allow ||
                (!sid.Equals(owner) && !sid.Equals(system)))
                throw new InvalidOperationException("workspace-journal-file-acl");
        }
        if (rules.Count == 0) throw new InvalidOperationException("workspace-journal-file-acl");
    }

    internal static AppContainerProfile Create()
    {
#if APPCONTAINER_TEST
        string local = AppDomain.CurrentDomain.BaseDirectory;
#else
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
#endif
        if (string.IsNullOrEmpty(local) || !Path.IsPathRooted(local))
            throw new InvalidOperationException("profile-journal-unavailable");
        string ownerRoot = Path.Combine(local, "AEGIS");
        string journal = Path.Combine(ownerRoot, "AppContainerJournal");
        List<IntPtr> pins = new List<IntPtr>();
        FileStream held = null;
        try
        {
            PinAncestors(local, pins);
            EnsurePrivateDirectory(ownerRoot, pins);
            EnsurePrivateDirectory(journal, pins);
            string lockPath = Path.Combine(journal, ".lock");
            held = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite,
                FileShare.None);
            if ((File.GetAttributes(lockPath) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("profile-journal-lock-reparse");
            Recover(journal);
            if (Directory.GetFiles(journal, "aegis-action-*.profile").Length >= MaxPending)
                throw new InvalidOperationException("profile-journal-full");
            string name = "aegis-action-" + Guid.NewGuid().ToString("N");
            string marker = Path.Combine(journal, name + ".profile");
            using (FileStream file = new FileStream(marker, FileMode.CreateNew, FileAccess.Write,
                FileShare.None)) file.Flush(true);
            AppContainerProfile result = new AppContainerProfile(held, pins, marker, name);
            bool collision = false;
            try
            {
                IntPtr sid;
                int hr = CreateAppContainerProfile(name, "AEGIS selected action",
                    "Disposable isolated action", IntPtr.Zero, 0, out sid);
                if (hr == unchecked((int)0x800700B7))
                {
                    // A profile that already existed is not ours to remove.
                    collision = true;
                    using (FileStream foreign = new FileStream(marker, FileMode.Open,
                        FileAccess.Write, FileShare.None))
                    {
                        foreign.WriteByte(1);
                        foreign.Flush(true);
                    }
                    File.Delete(marker);
                    throw new InvalidOperationException("profile-name-collision");
                }
                if (hr < 0 || sid == IntPtr.Zero)
                    throw new InvalidOperationException("profile-create-failed");
                result.Sid = sid;
                return result;
            }
            catch
            {
                if (!collision && File.Exists(marker)) result.Cleanup();
                result.ownsProfile = !collision;
                result.Dispose();
                throw;
            }
        }
        catch
        {
            if (held != null) held.Dispose();
            foreach (IntPtr pin in pins) CloseHandle(pin);
            throw;
        }
    }

    private static void PinAncestors(string directory, List<IntPtr> pins)
    {
        string full = Path.GetFullPath(directory);
        string current = Path.GetPathRoot(full);
        Pin(current, pins);
        foreach (string part in full.Substring(current.Length).Split(Path.DirectorySeparatorChar))
        {
            if (part.Length == 0) continue;
            current = Path.Combine(current, part);
            Pin(current, pins);
        }
    }

    private static void Pin(string path, List<IntPtr> pins)
    {
        IntPtr handle = CreateFile(path, 0x80, 3, IntPtr.Zero, 3,
            0x02000000 | 0x00200000, IntPtr.Zero);
        if (handle == new IntPtr(-1))
            throw new InvalidOperationException("profile-journal-unavailable");
        FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info) ||
            (info.attributes & (uint)FileAttributes.Directory) == 0 ||
            (info.attributes & (uint)FileAttributes.ReparsePoint) != 0)
        {
            CloseHandle(handle);
            throw new InvalidOperationException("profile-journal-reparse");
        }
        pins.Add(handle);
    }

    private static void EnsurePrivateDirectory(string directory, List<IntPtr> pins,
        bool create = true)
    {
        if (!Directory.Exists(directory))
        {
            if (!create) throw new InvalidOperationException("workspace-journal-unavailable");
            DirectorySecurity acl = new DirectorySecurity();
            SecurityIdentifier owner = WindowsIdentity.GetCurrent().User;
            acl.SetOwner(owner);
            acl.SetAccessRuleProtection(true, false);
            acl.AddAccessRule(new FileSystemAccessRule(owner, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(directory, acl);
        }
        Pin(directory, pins);
        DirectorySecurity effective = new DirectoryInfo(directory).GetAccessControl();
        SecurityIdentifier ownerSid = WindowsIdentity.GetCurrent().User;
        if (!ownerSid.Equals(effective.GetOwner(typeof(SecurityIdentifier))) ||
            !effective.AreAccessRulesProtected)
            throw new InvalidOperationException("profile-journal-owner");
        AuthorizationRuleCollection rules = effective.GetAccessRules(true, true,
            typeof(SecurityIdentifier));
        if (rules.Count != 2) throw new InvalidOperationException("profile-journal-acl");
        bool ownerRule = false, systemRule = false;
        SecurityIdentifier systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        foreach (FileSystemAccessRule rule in rules)
        {
            SecurityIdentifier principal = (SecurityIdentifier)rule.IdentityReference;
            if (rule.IsInherited || rule.AccessControlType != AccessControlType.Allow ||
                rule.FileSystemRights != FileSystemRights.FullControl ||
                rule.InheritanceFlags != (InheritanceFlags.ContainerInherit |
                    InheritanceFlags.ObjectInherit) ||
                rule.PropagationFlags != PropagationFlags.None)
                throw new InvalidOperationException("profile-journal-acl");
            if (principal.Equals(ownerSid)) ownerRule = true;
            else if (principal.Equals(systemSid)) systemRule = true;
            else throw new InvalidOperationException("profile-journal-acl");
        }
        if (!ownerRule || !systemRule) throw new InvalidOperationException("profile-journal-acl");
    }

    private static void Recover(string journal)
    {
        Stopwatch elapsed = Stopwatch.StartNew();
        string[] markers = Directory.GetFiles(journal, "aegis-action-*.profile");
        if (markers.Length > MaxPending)
            throw new InvalidOperationException("profile-journal-full");
        foreach (string marker in markers)
        {
            if (elapsed.ElapsedMilliseconds >= 4000)
                throw new InvalidOperationException("profile-recovery-timeout");
            string filename = Path.GetFileName(marker);
            if (!MarkerName.IsMatch(filename) ||
                (File.GetAttributes(marker) & FileAttributes.ReparsePoint) != 0 ||
                new FileInfo(marker).Length != 0)
                throw new InvalidOperationException("profile-journal-invalid");
            string name = filename.Substring(0, filename.Length - ".profile".Length);
            if (TryDelete(name)) File.Delete(marker);
            if (elapsed.ElapsedMilliseconds >= 4000)
                throw new InvalidOperationException("profile-recovery-timeout");
        }
    }

    private static bool TryDelete(string profileName)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            int hr = DeleteAppContainerProfile(profileName);
            if (hr >= 0) return true;
        }
        return false;
    }

    internal bool Cleanup()
    {
        if (CleanupConfirmed) return true;
        if (!TryDelete(name)) return false;
        try { File.Delete(marker); }
        catch { return false; }
        CleanupConfirmed = true;
        return true;
    }

    public void Dispose()
    {
        if (ownsProfile && !CleanupConfirmed && File.Exists(marker)) Cleanup();
        if (Sid != IntPtr.Zero) { FreeSid(Sid); Sid = IntPtr.Zero; }
        journalLock.Dispose();
        for (int i = pinnedDirectories.Count - 1; i >= 0; i--) CloseHandle(pinnedDirectories[i]);
        pinnedDirectories.Clear();
    }
}
