using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

// Held process/Job observations for a fixed same-principal child. No PID reopen.
internal static class BootstrapObservation
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Limits
    {
        public long UserTime, JobTime;
        public uint Flags;
        public IntPtr Minimum, Maximum;
        public uint ActiveLimit;
        public IntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Accounting
    {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, out Limits value, int length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "QueryInformationJobObject")] private static extern bool QueryAccounting(IntPtr job, int kind, out Accounting value, int length, IntPtr returned);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder value, ref int length);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int length, out int returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
    private static readonly IntPtr Self = new IntPtr(-1);
    internal static string RuntimeHash() { return BootstrapWire.HashFile(typeof(object).Assembly.Location); }
    internal static string PrincipalHash(IntPtr process)
    {
        IntPtr token = IntPtr.Zero, buffer = IntPtr.Zero;
        try
        {
            BootstrapWire.Require(OpenProcessToken(process, 8, out token));
            int length;
            GetTokenInformation(token, 1, IntPtr.Zero, 0, out length);
            BootstrapWire.Require(length >= IntPtr.Size && length <= 65536);
            buffer = Marshal.AllocHGlobal(length);
            BootstrapWire.Require(GetTokenInformation(token, 1, buffer, length, out length));
            var sid = new SecurityIdentifier(Marshal.ReadIntPtr(buffer));
            return BootstrapWire.Hash(BootstrapWire.Utf8.GetBytes(sid.Value));
        }
        finally { if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); if (token != IntPtr.Zero) CloseHandle(token); }
    }
    internal static bool InJob(IntPtr process, IntPtr job)
    {
        bool assigned;
        BootstrapWire.Require(IsProcessInJob(process, job, out assigned));
        return assigned;
    }
    internal static uint ActiveProcesses(IntPtr job)
    {
        Accounting accounting;
        BootstrapWire.Require(QueryAccounting(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        return accounting.Active;
    }
    internal static string Stamp(IntPtr process)
    {
        long birth, exit, kernel, user;
        uint pid = GetProcessId(process);
        BootstrapWire.Require(GetProcessTimes(process, out birth, out exit, out kernel, out user));
        BootstrapWire.Require(pid != 0 && birth > 0);
        return BootstrapWire.Hash(BootstrapWire.Utf8.GetBytes(pid.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + birth.ToString("x16")));
    }
    internal static Dictionary<string, object> Observe(Native.Session child, string image)
    {
        BootstrapWire.Phase = "held-process";
        BootstrapWire.Require(Native.WaitForSingleObject(child.Process, 0) == 0x102);
        BootstrapWire.Require(InJob(child.Process, child.Job));
        int size = 32768;
        var observedImage = new StringBuilder(size);
        BootstrapWire.Phase = "held-image";
        BootstrapWire.Require(QueryFullProcessImageName(child.Process, 0, observedImage, ref size) &&
            string.Equals(observedImage.ToString(), image, StringComparison.OrdinalIgnoreCase));
        Limits limits;
        BootstrapWire.Phase = "job-query";
        BootstrapWire.Require(QueryInformationJobObject(child.Job, 2, out limits, Marshal.SizeOf(typeof(Limits)), IntPtr.Zero));
        BootstrapWire.Phase = "job-limit-flags";
        BootstrapWire.Require((limits.Flags & 0x2000) != 0 && (limits.Flags & 0x1800) == 0);
        BootstrapWire.Phase = "job-accounting";
        // .NET Console may add conhost. This fixture pins one held child, not
        // a complete runtime/member inventory; termination queries the whole Job.
        BootstrapWire.Require(ActiveProcesses(child.Job) > 0);
        BootstrapWire.Phase = "held-principal";
        string principal = PrincipalHash(child.Process);
        BootstrapWire.Require(principal == PrincipalHash(Self));
        BootstrapWire.Phase = "held-birth";
        string stamp = Stamp(child.Process);
        BootstrapWire.Require(Native.WaitForSingleObject(child.Process, 0) == 0x102);
        return new Dictionary<string, object> {
            { "processStampSha256", stamp }, { "imageSha256", BootstrapWire.HashFile(image) },
            { "runtimeSha256", RuntimeHash() }, { "principalSha256", principal },
            { "jobSha256", BootstrapWire.Hash(BootstrapWire.Utf8.GetBytes(stamp + ":" + limits.Flags.ToString("x8"))) }
        };
    }
    internal static string OwnPrincipal() { return PrincipalHash(Self); }
    internal static bool OwnJob() { return InJob(Self, IntPtr.Zero); }
}
