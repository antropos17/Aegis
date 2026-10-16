using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// A benign native child, never Electron. Only the compile-out factory selects
// the current test principal; real process, suspension, Job and file APIs run.
internal static class ProcessFixture
{
    private const string Product = "AEGIS - AI Monitoring & Threat Detection.exe";
    private const string Grandchild = "fixture-grandchild.exe";
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int Size; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateEvent(ref SecurityAttributes attributes, bool manual, bool initial, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetEvent(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    private static string checkpoint = "arguments";
    private static string firstFailure = "none", cleanupFailure = "none";
    private static string observedMode = "none", observedRunning = "unobserved";
    private static void Need(bool value) { if (!value) throw new InvalidDataException("fixture-refused"); }
    private static string Bit(bool value) { return value ? "true" : "false"; }
    private static void Publish(string profile, string name, string value)
    {
        string temporary = Path.Combine(profile, name + ".tmp");
        using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value); file.Write(bytes, 0, bytes.Length); file.Flush(true);
        }
        File.Move(temporary, Path.Combine(profile, name + ".json"));
    }
    private static void WaitForFile(string path)
    {
        var watch = Stopwatch.StartNew();
        while (!File.Exists(path)) { Need(watch.ElapsedMilliseconds < 5000); Thread.Sleep(2); }
        Need(new FileInfo(path).Length <= 1024);
    }
    private static int GrandchildMain(string[] args)
    {
        Need(args.Length == 1 && Path.IsPathRooted(args[0]));
        Publish(args[0], "grandchild-ready", "{\"ready\":true}");
        using (var quit = new ManualResetEvent(false)) quit.WaitOne(15000);
        return 0;
    }
    private static int Child(string[] args)
    {
        Need(args.Length == 2 && args[0] == "--aegis-owned-gui-profile");
        string profile = args[1];
        Need(Path.IsPathRooted(profile) && Directory.Exists(profile));
        string control = Path.Combine(profile, "fixture-control");
        string mode = File.Exists(control) ? File.ReadAllText(control) : "environment";
        bool canaryAttempted = mode.StartsWith("handle:", StringComparison.Ordinal);
        if (canaryAttempted)
        {
            long handle; Need(Int64.TryParse(mode.Substring(7), out handle) && handle != 0);
            // The parent independently observes its ORIGINAL event. A coincident
            // unrelated handle value here cannot make an inheritance test pass.
            SetEvent(new IntPtr(handle));
        }
        if (mode == "descendant" || mode == "root-exit")
        {
            var start = new ProcessStartInfo(Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), Grandchild), "\"" + profile + "\"");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            using (var descendant = Process.Start(start)) Need(descendant != null);
            WaitForFile(Path.Combine(profile, "grandchild-ready.json"));
        }
        string report = "{\"poisonPresent\":" + Bit(Environment.GetEnvironmentVariable("AEGIS_TEST_POISON") != null) +
            ",\"nodeOptionsPresent\":" + Bit(Environment.GetEnvironmentVariable("NODE_OPTIONS") != null) +
            ",\"fixedArguments\":true,\"handleProbeAttempted\":" + Bit(canaryAttempted) +
            ",\"processId\":" + Process.GetCurrentProcess().Id + "}";
        Publish(profile, "child-ready", report);
        if (mode == "natural-exit") { WaitForFile(Path.Combine(profile, "fixture-exit-now")); return 0; }
        if (mode == "root-exit") { WaitForFile(Path.Combine(profile, "fixture-exit-now")); return 0; }
        // Safety ceiling only. Assertions synchronize on the completed file,
        // not elapsed child sleep or process-start timing.
        using (var quit = new ManualResetEvent(false)) quit.WaitOne(10000);
        return 0;
    }
#if PROTECTED_GUI_PROCESS_TEST
    private static int Parent(string[] args)
    {
        Need(args.Length == 3);
        string mode = args[0];
        observedMode = mode;
        Need(mode == "environment" || mode == "cancel" || mode == "descendant" || mode == "root-exit" || mode == "handle" || mode == "double-release");
        string image = Path.GetFullPath(args[1]), profile = Path.GetFullPath(args[2]);
        Need(Path.GetFileName(image) == Product && File.Exists(image) && Directory.Exists(profile) &&
            Directory.GetFileSystemEntries(profile).Length == 0);
        string ready = Path.Combine(profile, "child-ready.json");
        string originalPoison = Environment.GetEnvironmentVariable("AEGIS_TEST_POISON");
        string originalOptions = Environment.GetEnvironmentVariable("NODE_OPTIONS");
        ProtectedGuiProcessNative owner = null;
        IntPtr canary = IntPtr.Zero;
        IntPtr originalRootWait = IntPtr.Zero;
        bool suspended = false, stopped = false, originalCanaryUnsignaled = false, duplicateRefused = false, rootExitedWithDescendant = false;
        uint originalPid = 0, runningCount = 0;
        string rootExitState = null;
        string child = null;
        try
        {
            Environment.SetEnvironmentVariable("AEGIS_TEST_POISON", "fixture-parent-only");
            Environment.SetEnvironmentVariable("NODE_OPTIONS", "--trace-warnings");
            if (mode == "handle")
            {
                var attributes = new SecurityAttributes { Size = Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = 1 };
                canary = CreateEvent(ref attributes, true, false, null);
                uint flags; Need(canary != IntPtr.Zero && GetHandleInformation(canary, out flags) && (flags & 1) == 1);
                File.WriteAllText(Path.Combine(profile, "fixture-control"), "handle:" + canary.ToInt64());
            }
            else if (mode != "environment") File.WriteAllText(Path.Combine(profile, "fixture-control"), mode);
            checkpoint = "create";
            owner = ProtectedGuiProcessNative.PrepareForTest(image, profile);
            checkpoint = "suspended";
            owner.Check(); var initial = owner.GetState();
            suspended = initial.RootAlive && initial.ActiveProcesses == 1 && !initial.Released &&
                !initial.CleanupUnknown && !File.Exists(ready);
            Need(suspended && owner.ProcessId != 0);
            originalPid = owner.ProcessId;
            // Capture a wait-only observation of this still-suspended original;
            // no later PID lookup or process termination is used by the fixture.
            if (mode == "root-exit") { originalRootWait = OpenProcess(0x100000, false, originalPid); Need(originalRootWait != IntPtr.Zero); }
            if (mode != "cancel")
            {
                checkpoint = "release"; owner.Release();
                if (mode == "double-release")
                {
                    try { owner.Release(); } catch (InvalidDataException) { duplicateRefused = true; }
                    Need(duplicateRefused && owner.GetState().RootAlive && !owner.CleanupUnknown);
                }
                checkpoint = "readiness"; WaitForFile(ready); child = File.ReadAllText(ready);
                Need(child.StartsWith("{", StringComparison.Ordinal) && child.EndsWith("}", StringComparison.Ordinal));
                checkpoint = "running";
                if (mode == "root-exit")
                {
                    var beforeExit = owner.GetState();
                    Need(beforeExit.RootAlive && beforeExit.ActiveProcesses == 2 && beforeExit.Released && !beforeExit.CleanupUnknown);
                    File.WriteAllText(Path.Combine(profile, "fixture-exit-now"), "exit-original-root");
                    Need(WaitForSingleObject(originalRootWait, 5000) == 0);
                }
                var running = owner.GetState(); runningCount = running.ActiveProcesses;
                if (mode == "root-exit") { rootExitState = running.State; rootExitedWithDescendant = !running.RootAlive && running.ActiveProcesses == 1; Need(rootExitedWithDescendant); }
                observedRunning = "alive=" + Bit(running.RootAlive) + ",active=" + running.ActiveProcesses +
                    ",released=" + Bit(running.Released) + ",unknown=" + Bit(running.CleanupUnknown);
                Need(running.Released && !running.CleanupUnknown && runningCount == (mode == "descendant" ? 2U : 1U));
                if (mode != "root-exit") Need(running.RootAlive);
                if (mode == "handle") { originalCanaryUnsignaled = WaitForSingleObject(canary, 0) == 0x102; Need(originalCanaryUnsignaled); }
            }
        }
        catch
        {
            firstFailure = checkpoint; throw;
        }
        finally
        {
            try
            {
                if (owner != null)
                {
                    checkpoint = "stop"; owner.Stop();
                    checkpoint = "observe-stopped"; var final = owner.GetState();
                    stopped = !final.RootAlive && final.ActiveProcesses == 0 && !final.CleanupUnknown;
                    Need(stopped); checkpoint = "dispose"; owner.Dispose();
                    checkpoint = "closure-marker";
                    File.WriteAllText(Path.Combine(profile, "cleanup.confirmed"), "original-root-exited-and-job-empty");
                }
            }
            catch
            {
                cleanupFailure = checkpoint; throw;
            }
            finally
            {
                Environment.SetEnvironmentVariable("AEGIS_TEST_POISON", originalPoison);
                Environment.SetEnvironmentVariable("NODE_OPTIONS", originalOptions);
                if (canary != IntPtr.Zero) Need(CloseHandle(canary));
                if (originalRootWait != IntPtr.Zero) Need(CloseHandle(originalRootWait));
            }
        }
        Console.WriteLine("{\"actualNativeProcess\":true,\"modeledPrincipal\":true,\"suspendedNoEffect\":" + Bit(suspended) +
            ",\"rootExitedAndJobEmpty\":" + Bit(stopped) + ",\"originalProcessId\":" + originalPid +
            ",\"cancelNoEffect\":" + Bit(mode == "cancel" && !File.Exists(ready)) +
            ",\"runningCount\":" + runningCount + ",\"originalCanaryUnsignaled\":" + Bit(originalCanaryUnsignaled) +
            ",\"duplicateReleaseRefused\":" + Bit(duplicateRefused) + ",\"rootExitedWithDescendant\":" + Bit(rootExitedWithDescendant) +
            ",\"rootExitState\":" + (rootExitState == null ? "null" : "\"" + rootExitState + "\"") +
            ",\"child\":" + (child ?? "null") + "}");
        return 0;
    }
#endif
    private static int Main(string[] args)
    {
        try
        {
            if (Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName) == Product) return Child(args);
            if (Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName) == Grandchild) return GrandchildMain(args);
#if PROTECTED_GUI_PROCESS_TEST
            return Parent(args);
#else
            Need(args.Length == 1 && args[0] == "production");
            var core = new Type[] { typeof(ProtectedInstallFile), typeof(ProtectedGuiManifest), typeof(ProtectedGuiBundleNative),
                typeof(ProtectedGuiBundleFiles), typeof(ProtectedGuiIdentity), typeof(ProtectedGuiExecutionPins),
                typeof(ProtectedGuiProcessNative), typeof(ProtectedGuiProcessLease), typeof(ProtectedGuiProcessProfile) };
            Need(core.Length == 9 && typeof(ProcessFixture).Assembly.GetType("ProcessTestControls") == null);
            foreach (var type in typeof(ProcessFixture).Assembly.GetTypes())
                foreach (var member in type.GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic |
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly))
                    Need(member.Name.IndexOf("ForTest", StringComparison.Ordinal) < 0);
            Console.WriteLine("{\"nineSourceAssembly\":true,\"testFactoryPresent\":false}"); return 0;
#endif
        }
        catch
        {
            Console.Error.WriteLine("protected-gui-process-fixture:" + checkpoint + ";first=" + firstFailure + ";cleanup=" + cleanupFailure +
                ";mode=" + observedMode + ";running=" + observedRunning); return 2;
        }
    }
}
