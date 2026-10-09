using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class LauncherObservation
{
    [StructLayout(LayoutKind.Sequential)] internal struct FileTime { internal uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] internal struct FileInfo
    {
        internal uint Attributes;
        internal FileTime Created, Accessed, Written;
        internal uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        internal string Identity { get { return Volume + ":" + IndexHigh + ":" + IndexLow; } }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Security
    { internal int Size; internal IntPtr Descriptor; internal int Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    {
        internal long ProcessTime, JobTime; internal uint Flags;
        internal IntPtr Minimum, Maximum; internal uint ActiveLimit;
        internal IntPtr Affinity; internal uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { internal ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    {
        internal BasicLimits Basic; internal IoCounters Io;
        internal IntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing,
        ref Security security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool GetHandleInformation(SafeFileHandle handle, out uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(SafeFileHandle process, uint flags,
        StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint SuspendThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool WriteFile(SafeFileHandle file, byte[] bytes, uint length, out uint written, IntPtr overlap);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(SafeFileHandle process, SafeFileHandle job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out Limits limits,
        int size, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(SafeFileHandle token, uint access, IntPtr attributes,
        int level, int type, out SafeFileHandle copy);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetThreadToken(IntPtr thread, SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenThreadToken(IntPtr thread, uint access, bool openAsSelf, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(SafeFileHandle token, int kind, out int value, int size, out int returned);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool RevertToSelf();

    internal static void Require(bool value, string message)
    { if (!value) throw new InvalidOperationException(message); }
    internal static void JobAndHandles(SafeFileHandle process, SafeFileHandle thread, SafeFileHandle job)
    {
        bool member; Limits limits;
        Require(IsProcessInJob(process, job, out member) && member &&
            QueryInformationJobObject(job, 9, out limits, Marshal.SizeOf(typeof(Limits)), IntPtr.Zero) &&
            (limits.Basic.Flags & (0x2000 | 8)) == (0x2000 | 8) && limits.Basic.ActiveLimit == 64,
            "independent-job-containment");
        foreach (SafeFileHandle handle in new[] { process, thread, job })
        {
            uint flags;
            Require(GetHandleInformation(handle, out flags) && (flags & 1) == 0,
                "independent-owner-handle-inheritance");
        }
    }
    internal static SafeFileHandle Sentinel(string path)
    {
        var security = new Security(); security.Size = Marshal.SizeOf(typeof(Security)); security.Inherit = 1;
        var handle = CreateFile(path, 0xC0000000, 0, ref security, 1, 0, IntPtr.Zero);
        uint flags;
        Require(!handle.IsInvalid && GetHandleInformation(handle, out flags) && (flags & 1) != 0,
            "sentinel-not-inheritable");
        return handle;
    }
    internal static string Image(SafeFileHandle process)
    {
        var name = new StringBuilder(32768); uint length = (uint)name.Capacity;
        Require(QueryFullProcessImageName(process, 0, name, ref length), "independent-image-query");
        return name.ToString();
    }
    internal static SafeFileHandle Hold(uint pid)
    {
        var handle = OpenProcess(0x00101000, false, pid);
        Require(!handle.IsInvalid, "independent-process-hold"); return handle;
    }
    internal static void Until(Func<bool> value, string label)
    {
        var watch = System.Diagnostics.Stopwatch.StartNew();
        while (!value())
        {
            Require(watch.ElapsedMilliseconds < 4000, label);
            System.Threading.Thread.Sleep(5);
        }
    }
    internal static uint ReadPid(string path)
    {
        uint pid = 0;
        Until(() => {
            if (!File.Exists(path)) return false;
            string value;
            try { value = File.ReadAllText(path); }
            catch (IOException error)
            {
                // Creation is visible before File.WriteAllText closes its write handle.
                // Keep read-only sharing so only a completed, closed write can be read.
                int code = error.HResult & 0xffff;
                if (code == 32 || code == 33) return false;
                throw;
            }
            Require(uint.TryParse(value, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out pid) && pid > 0 &&
                value == pid.ToString(System.Globalization.CultureInfo.InvariantCulture), "pid-marker-invalid");
            return true;
        }, "pid-marker-timeout");
        return pid;
    }

    // Uses independent OS queries to prove the release attempt runs with an actual thread token.
    internal static void WithThreadToken(Action attempt)
    {
        SafeFileHandle primary, copy, observed;
        Require(OpenProcessToken(GetCurrentProcess(), 0xA, out primary), "fixture-primary-token");
        using (primary)
        {
            Require(DuplicateTokenEx(primary, 0xC, IntPtr.Zero, 2, 2, out copy), "fixture-token-copy");
            using (copy)
            {
                Require(SetThreadToken(IntPtr.Zero, copy), "fixture-thread-token-set");
                try
                {
                    Require(OpenThreadToken(GetCurrentThread(), 8, true, out observed), "fixture-thread-token-query");
                    using (observed)
                    {
                        int type, level, returned;
                        Require(GetTokenInformation(observed, 8, out type, 4, out returned) && returned == 4 && type == 2 &&
                            GetTokenInformation(observed, 9, out level, 4, out returned) && returned == 4 && level == 2,
                            "fixture-thread-token-profile");
                    }
                    attempt();
                }
                finally { if (!RevertToSelf()) Environment.FailFast("fixture-thread-reversion-failed"); }
            }
        }
    }
}
