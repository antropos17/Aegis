using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Retain only a child with the exact image, parent, and coherent process birth.
internal static class GuardTerminalWitness
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct ProcessEntry
    {
        public uint Size, Usage, ProcessId;
        public UIntPtr Heap;
        public uint Module, Threads, ParentId;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static IntPtr FindChild(uint parent, string exe, long parentBirth, out uint pid, out long birth)
    {
        pid = 0; birth = 0;
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new InvalidOperationException("snapshot-failed");
        try
        {
            var item = new ProcessEntry(); item.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            bool more = Process32First(snapshot, ref item);
            while (more)
            {
                if (item.ParentId == parent && String.Equals(item.Name, Path.GetFileName(exe), StringComparison.OrdinalIgnoreCase))
                {
                    IntPtr held = OpenProcess(0x1000 | 0x100000 | 1, false, item.ProcessId);
                    if (held != IntPtr.Zero)
                    {
                        var image = new StringBuilder(32768); int length = image.Capacity;
                        long created, exited, kernel, user;
                        if (QueryFullProcessImageName(held, 0, image, ref length) &&
                            String.Equals(Path.GetFullPath(image.ToString()), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase) &&
                            GetProcessTimes(held, out created, out exited, out kernel, out user) && created >= parentBirth && exited == 0)
                        { pid = item.ProcessId; birth = created; return held; }
                        CloseHandle(held);
                    }
                }
                more = Process32Next(snapshot, ref item);
            }
            return IntPtr.Zero;
        }
        finally { CloseHandle(snapshot); }
    }
    private static int Main(string[] args)
    {
        int parentId;
        if (args.Length != 5 || !Int32.TryParse(args[0], out parentId) || parentId <= 0) return 2;
        Process parent = null; IntPtr child = IntPtr.Zero;
        try
        {
            parent = Process.GetProcessById(parentId);
            if (!String.Equals(parent.MainModule.FileName, args[1], StringComparison.OrdinalIgnoreCase) || parent.HasExited ||
                parent.StartTime.ToUniversalTime() < DateTime.UtcNow.AddSeconds(-10)) throw new InvalidOperationException("parent-identity");
            long parentBirth = parent.StartTime.ToUniversalTime().ToFileTimeUtc();
            var heldParent = parent.Handle;
            using (new FileStream(args[3], FileMode.CreateNew, FileAccess.Write)) { }
            var deadline = DateTime.UtcNow.AddSeconds(12);
            uint pid = 0; long birth = 0;
            while (child == IntPtr.Zero && !parent.HasExited && DateTime.UtcNow < deadline)
            { child = FindChild((uint)parentId, args[2], parentBirth, out pid, out birth); if (child == IntPtr.Zero) Thread.Sleep(5); }
            if (child == IntPtr.Zero) throw new InvalidOperationException("child-identity-unavailable");
            bool forced = false;
            if (WaitForSingleObject(child, 60000) != 0)
            {
                forced = true;
                if (!TerminateProcess(child, 2)) throw new InvalidOperationException("owned-termination-failed");
            }
            bool gone = WaitForSingleObject(child, 5000) == 0;
            uint code = 0; bool exitObserved = gone && GetExitCodeProcess(child, out code);
            string result = "{\"identified\":true,\"pid\":" + pid + ",\"birth100ns\":\"" + birth +
                "\",\"gone\":" + (gone ? "true" : "false") + ",\"forced\":" + (forced ? "true" : "false") +
                ",\"exitCode\":" + (exitObserved ? code.ToString() : "null") + "}\n";
            File.WriteAllText(args[4], result);
            return gone ? 0 : 2;
        }
        catch
        {
            try { File.WriteAllText(args[4], "{\"identified\":false,\"gone\":false,\"exitCode\":null}\n"); } catch { }
            return 2;
        }
        finally { if (child != IntPtr.Zero) CloseHandle(child); if (parent != null) parent.Dispose(); }
    }
}
