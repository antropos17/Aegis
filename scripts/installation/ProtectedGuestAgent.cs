using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Aegis.ProtectedSession;

// Runs inside the authenticated guest administrative session, never on the host.
public static class ProtectedGuestAgent
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Startup {
        public int Size; public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedLength; public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
        public long User, Job; public uint Flags; public IntPtr Minimum, Maximum;
        public uint Active; public IntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Io { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits { public BasicLimits Basic; public Io Io; public IntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithLogonW(string user, string domain, string password, uint logon,
        string application, StringBuilder command, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int bytes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("protected-guest-agent-refused"); }
    public static string Quote(string value)
    {
        Require(value != null && value.Length <= 4096 && value.IndexOf('\0') < 0);
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    public static uint Run(string path, string digest, string[] arguments, string working, string user,
        string password, string sid, int milliseconds)
    {
        Require(milliseconds >= 100 && milliseconds <= 120000 && arguments != null && arguments.Length <= 16 &&
            path == Path.GetFullPath(path) && path.StartsWith("C:\\ProgramData\\AEGIS\\Guest\\", StringComparison.Ordinal) &&
            !String.Equals(user, "Administrator", StringComparison.OrdinalIgnoreCase));
        var command = new StringBuilder(Quote(path));
        foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
        Require(command.Length <= 8192);
        using (var image = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var sha = SHA256.Create()) {
            Require(image.Length > 0 && image.Length <= 4 * 1024 * 1024 &&
                BitConverter.ToString(sha.ComputeHash(image)).Replace("-", "").ToLowerInvariant() == digest);
            IntPtr job = IntPtr.Zero, environment = IntPtr.Zero; ProcessInfo child = new ProcessInfo();
            bool assigned = false;
            using (var desktop = new ProtectedGuestDesktop(sid)) {
                try {
                    job = CreateJobObject(IntPtr.Zero, null); Require(job != IntPtr.Zero);
                    var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8 | 0x100;
                    limits.Basic.Active = 32; limits.ProcessMemory = new IntPtr(512 * 1024 * 1024);
                    Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                    // Explicit environment excludes the administrative session's secrets.
                    string system = Environment.GetEnvironmentVariable("SystemRoot");
                    string block = "COMSPEC=" + system + "\\System32\\cmd.exe\0PATH=" + system + "\\System32\0SystemRoot=" + system +
                        "\0TEMP=" + working + "\0TMP=" + working + "\0WINDIR=" + system + "\0\0";
                    environment = Marshal.StringToHGlobalUni(block);
                    var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup)); startup.Desktop = desktop.Path;
                    Require(CreateProcessWithLogonW(user, ".", password, 0, path, command, 0x08000404, environment, working, ref startup, out child));
                    Require(AssignProcessToJobObject(job, child.Process)); assigned = true;
                    GuestJobNative.RequireStandardPrincipal(child.Process, sid, Process.GetCurrentProcess().SessionId);
                    Require(String.Equals(GuestJobNative.Image(child.Process), path, StringComparison.OrdinalIgnoreCase));
                    GuestJobNative.Birth(child.Process, job, child.Pid);
                    int checkpoint = 0; GuestJobNative.RequireSingleton(job, ref checkpoint);
                    Require(ResumeThread(child.Thread) == 1);
                    Require(GuestJobNative.WaitForSingleObject(child.Process, (uint)milliseconds) == 0);
                    uint exit; Require(GetExitCodeProcess(child.Process, out exit)); return exit;
                } finally {
                    bool closed = true;
                    if (job != IntPtr.Zero && assigned) {
                        closed = TerminateJobObject(job, 125);
                        var timer = Stopwatch.StartNew();
                        while (closed && GuestJobNative.Counts(job).Active != 0 && timer.ElapsedMilliseconds < 5000)
                            System.Threading.Thread.Sleep(20);
                        closed = closed && GuestJobNative.Counts(job).Active == 0;
                    } else if (child.Process != IntPtr.Zero) closed = TerminateProcess(child.Process, 125);
                    if (child.Process != IntPtr.Zero) closed = GuestJobNative.WaitForSingleObject(child.Process, 5000) == 0 && closed;
                    if (child.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(child.Thread);
                    if (child.Process != IntPtr.Zero) GuestJobNative.CloseHandle(child.Process);
                    if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
                    if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                    Require(closed);
                }
            }
        }
    }
}
