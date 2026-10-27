using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

// A provider-free executable used only in a fresh qualification directory.
internal static class GuardTerminalStub
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Reserved1, Peb, Reserved2, Reserved3, ProcessId, ParentProcessId;
    }
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int infoClass,
        out ProcessInformation info, int length, out int returnedLength);
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll")] private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    private static int Main(string[] args)
    {
        string cwd = Directory.GetCurrentDirectory();
        string expectedSettings = Path.Combine(cwd, "settings.json");
        uint inputMode, outputMode;
        if (args.Length != 2 || args[0] != "--settings" || args[1] != expectedSettings ||
            File.ReadAllText(expectedSettings) != "{}\n" ||
            !GetConsoleMode(GetStdHandle(-10), out inputMode) ||
            !GetConsoleMode(GetStdHandle(-11), out outputMode) ||
            Environment.GetEnvironmentVariable("AEGIS_CLAUDE_GUARD_SESSION") != new string('a', 32) ||
            Environment.GetEnvironmentVariable("AEGIS_CLAUDE_GUARD_CAPABILITY") != new string('b', 64) ||
            String.IsNullOrEmpty(Environment.GetEnvironmentVariable("AEGIS_CLAUDE_GUARD_PORT")))
            return 2;
        ProcessInformation info;
        int returned;
        using (var current = Process.GetCurrentProcess())
        {
            if (NtQueryInformationProcess(current.Handle, 0, out info,
                Marshal.SizeOf(typeof(ProcessInformation)), out returned) != 0) return 2;
            using (var marker = new StreamWriter(new FileStream(Path.Combine(cwd, "stub-result.txt"), FileMode.CreateNew)))
                marker.Write("PASS " + current.Id + " " + info.ParentProcessId.ToInt64() + "\n");
        }
        Console.WriteLine("DISPOSABLE_GUARD_STUB_EXECUTED");
        return 0;
    }
}
