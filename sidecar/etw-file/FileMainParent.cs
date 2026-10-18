using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// Only the actual packaged Electron parent may hold the private recovery lease.
internal sealed class FileMainParent : IDisposable
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, Pid;
        public UIntPtr Heap;
        public uint Module, Threads, Parent;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Image;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32First(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32Next(SafeFileHandle snapshot, ref ProcessEntry entry);
    internal SafeProcessHandle Handle { get; }
    internal PeerIdentity Identity { get; }
    private FileMainParent(SafeProcessHandle handle, PeerIdentity identity) { Handle = handle; Identity = identity; }
    internal static string PackagedImage => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Program.Executable)!,
        "..", "..", "AEGIS - AI Monitoring & Threat Detection.exe"));

    internal static int ParentId(int processId)
    {
        using var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot.IsInvalid) throw new Win32Exception();
        var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>(), Image = "" };
        bool found = Process32First(snapshot, ref entry);
        while (found && entry.Pid != processId) found = Process32Next(snapshot, ref entry);
        if (!found || entry.Parent == 0 || entry.Parent > int.MaxValue) throw new UnauthorizedAccessException();
        return (int)entry.Parent;
    }
    internal static FileMainParent Open()
    {
        int pid = ParentId(Environment.ProcessId);
        var handle = FileMainHandles.OpenProcess(0x101040, false, pid);
        try
        {
            if (handle.IsInvalid || FileMainHandles.Gone(handle)) throw new UnauthorizedAccessException();
            var identity = Security.Observe(handle, pid); var self = Security.Current();
            if (identity.Elevated || identity.User != self.User || identity.Logon != self.Logon ||
                identity.Birth >= self.Birth || !identity.Image.Equals(PackagedImage, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException();
            return new(handle, identity);
        }
        catch { handle.Dispose(); throw; }
    }
    internal static SafeProcessHandle ObserveMain(int brokerPid, int mainPid, ulong birth)
    {
        if (ParentId(brokerPid) != mainPid) throw new UnauthorizedAccessException();
        var handle = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, mainPid);
        try
        {
            if (handle.IsInvalid || FileMainHandles.Gone(handle)) throw new UnauthorizedAccessException();
            var actual = Security.Observe(handle, mainPid); var self = Security.Current();
            if (actual.Birth != birth || actual.Elevated || actual.User != self.User || actual.Logon != self.Logon ||
                !actual.Image.Equals(PackagedImage, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    public void Dispose() => Handle.Dispose();
}
