using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Same-principal disposable token transition; no privileged effect or VM operation.
internal static class CallerContextFixture
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint openMode, uint pipeMode,
        uint instances, uint output, uint input, uint timeout, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(SafeFileHandle token, uint access, IntPtr attributes,
        int level, int type, out SafeFileHandle copy);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetThreadToken(IntPtr thread, SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenThreadToken(IntPtr thread, uint access, bool openAsSelf,
        out SafeFileHandle token);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool RevertToSelf();
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(SafeFileHandle token, int kind,
        out int value, int size, out int returned);

    private static string Flag(bool value) { return value.ToString().ToLowerInvariant(); }

    private static bool ThreadTokenObserved()
    {
        SafeFileHandle token;
        bool opened = OpenThreadToken(GetCurrentThread(), 8, true, out token);
        int error = Marshal.GetLastWin32Error();
        using (token)
        {
            if (!opened) { CallerNative.Require(error == 1008); return false; }
            int type, level, returned;
            CallerNative.Require(GetTokenInformation(token, 8, out type, 4, out returned) && returned == 4 && type == 2);
            CallerNative.Require(GetTokenInformation(token, 9, out level, 4, out returned) && returned == 4 && level == 2);
            return true;
        }
    }

    private static int Child()
    {
        string name = Console.ReadLine(), generation = Console.ReadLine(), session = Console.ReadLine();
        using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.Out,
            PipeOptions.None, TokenImpersonationLevel.Impersonation))
        {
            pipe.Connect(2000);
            string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"operation\":\"inspect-owned\"," +
                "\"requestId\":\"" + new string('a', 32) + "\",\"sessionId\":\"" + session +
                "\",\"generation\":\"" + generation + "\",\"sequence\":1}";
            byte[] bytes = Encoding.UTF8.GetBytes(json), frame = new byte[bytes.Length + 4];
            Buffer.BlockCopy(BitConverter.GetBytes(bytes.Length), 0, frame, 0, 4);
            Buffer.BlockCopy(bytes, 0, frame, 4, bytes.Length);
            pipe.Write(frame, 0, frame.Length);
            pipe.Flush();
            // EOF also ends this disposable child if its owner exits unexpectedly.
            Console.ReadLine();
        }
        return 0;
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "child") return Child();
        if (args.Length != 1 || (args[0] != "clean" && args[0] != "impersonated")) return 2;
        Process child = null;
        try
        {
            string name = "aegis-context-fixture-" + Guid.NewGuid().ToString("N");
            using (var pipe = CreateNamedPipe("\\\\.\\pipe\\" + name, 3 | 0x00080000,
                4 | 2 | 8, 1, 8192, 8192, 2000, IntPtr.Zero))
            {
                CallerNative.Require(!pipe.IsInvalid && !ThreadTokenObserved());
                child = Process.Start(new ProcessStartInfo {
                    FileName = typeof(CallerContextFixture).Assembly.Location, Arguments = "child",
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
                });
                using (var registration = new CallerRegistration(child.Handle, new string('b', 32)))
                {
                    child.StandardInput.WriteLine(name);
                    child.StandardInput.WriteLine(registration.Generation);
                    child.StandardInput.WriteLine(registration.Session);
                    child.StandardInput.Flush();
                    CallerNative.Require(ConnectNamedPipe(pipe, IntPtr.Zero) || Marshal.GetLastWin32Error() == 535);
                    var context = CallerAdmission.ReadAndAuthenticate(pipe, registration, new CallerNative());
                    CallerNative.Require(!ThreadTokenObserved());
                    int initialEffects = 0, impersonatedEffects = 0, revertedEffects = 0;
                    context.CheckCurrent(); initialEffects++;
                    bool observed = false, rejected = false;
                    if (args[0] == "impersonated")
                    {
                        using (var self = Process.GetCurrentProcess())
                        {
                            SafeFileHandle primary, copy;
                            CallerNative.Require(OpenProcessToken(self.Handle, 0xA, out primary));
                            using (primary)
                            {
                                CallerNative.Require(DuplicateTokenEx(primary, 0xC, IntPtr.Zero, 2, 2, out copy));
                                using (copy)
                                {
                                    CallerNative.Require(SetThreadToken(IntPtr.Zero, copy));
                                    try
                                    {
                                        observed = ThreadTokenObserved(); CallerNative.Require(observed);
                                        try { context.CheckCurrent(); impersonatedEffects++; }
                                        catch (InvalidOperationException) { rejected = true; }
                                    }
                                    finally { if (!RevertToSelf()) Environment.FailFast("fixture-reversion-failed"); }
                                }
                            }
                        }
                    }
                    bool reverted = !ThreadTokenObserved(); CallerNative.Require(reverted);
                    context.CheckCurrent(); revertedEffects++;
                    child.StandardInput.WriteLine("release"); child.StandardInput.Flush();
                    CallerNative.Require(child.WaitForExit(2000) && child.ExitCode == 0 && child.StandardError.ReadToEnd() == "");
                    Console.WriteLine("{\"admitted\":true,\"initialEffects\":" + initialEffects +
                        ",\"threadTokenObserved\":" + Flag(observed) + ",\"rejected\":" + Flag(rejected) +
                        ",\"impersonatedEffects\":" + impersonatedEffects + ",\"reverted\":" + Flag(reverted) +
                        ",\"revertedEffects\":" + revertedEffects + ",\"childExited\":true}");
                }
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ":" + error.Message); return 1; }
        finally
        {
            if (child != null)
            {
                try { if (!child.HasExited) child.Kill(); child.WaitForExit(2000); }
                finally { child.Dispose(); }
            }
        }
    }
}
