using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using Aegis.InstalledOwner;
using Aegis.ProtectedSession;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal partial class CallerLauncherNative
    {
        internal Created CreateExitFixture(string image, SafeFileHandle input, SafeFileHandle output, string argument)
        { return CreateCore(image, input, output, null, argument); }
    }
}

internal static class InstalledOwnerExitFixture
{
    private static readonly BindingFlags Fields = BindingFlags.Instance | BindingFlags.NonPublic;
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0].StartsWith("--exit-child:"))
        {
            string[] parts = args[0].Split(':');
            using (var release = EventWaitHandle.OpenExisting(parts[1]))
            {
                // EOF deliberately precedes process signaling; the parent confirms the process is still alive.
                CallerNative.Require(CloseHandle(InstalledOwnerPipe.GetStdHandle(-11)));
                CallerNative.Require(release.WaitOne(5000));
                Thread.Sleep(parts[2] == "delayed" || parts[2] == "active-code" ? 350 : 20000);
                return parts[2] == "active-code" ? 259 : 2;
            }
        }
        if (args.Length != 1) return 2;
        string mode = args[0], name = "Local\\AegisExitFixture" + Guid.NewGuid().ToString("N");
        using (var release = new EventWaitHandle(false, EventResetMode.ManualReset, name))
        using (var input = new InstalledOwnerPipe(false))
        using (var output = new InstalledOwnerPipe(true))
        {
            var runtime = new InstalledOwnerRuntime();
            var child = new CallerLauncherNative().CreateExitFixture(Assembly.GetExecutingAssembly().Location,
                input.Read, output.Write, "--exit-child:" + name + ":" +
                (mode == "delayed" || mode == "active-code" ? mode : "hung"));
            using (SafeFileHandle observed = CallerNative.DuplicateSelf())
            {
                // Duplicate the exact child's query/synchronize handle for assertions after cleanup closes originals.
                IntPtr held = InstalledOwnerPipe.Reduce(child.Process, observed, 0x00101000);
                using (var exact = new SafeFileHandle(held, true))
                {
                    typeof(InstalledOwnerRuntime).GetField("supervisor", Fields).SetValue(runtime, child);
                    typeof(InstalledOwnerRuntime).GetField("supervisorReleased", Fields).SetValue(runtime, true);
                    typeof(InstalledOwnerRuntime).GetField("phase", Fields).SetValue(runtime, "await-completion");
                    input.Read.Dispose(); output.Write.Dispose();
                    CallerNative.Require(CallerLauncherNative.ResumeThread(child.Thread) == 1);
                    bool eof = false;
                    try { InstalledOwnerPipe.ReadExact(output.Read, 104, new InstalledOwnerDeadline(2000)); }
                    catch (InvalidOperationException) { eof = true; }
                    CallerNative.Require(eof && CallerNative.WaitForSingleObject(exact, 0) == 0x102);
                    var deadline = new InstalledOwnerDeadline(mode == "budget" ? 150 : mode == "expired" ? 1 : 4000);
                    if (mode == "expired") Thread.Sleep(10);
                    using (var current = CallerNative.ProcessToken(observed))
                        CallerNative.Require(!CallerIdentity.Observe(current).InstalledSystem());
                    release.Set(); var watch = Stopwatch.StartNew();
                    try
                    {
                        if (mode == "stop") runtime.Dispose();
                        else if (mode == "cancel" || mode == "expire")
                        {
                            var worker = new Thread(delegate() { runtime.Run(deadline); });
                            worker.Start(); Thread.Sleep(150); watch.Restart();
                            if (mode == "expire") typeof(InstalledOwnerRuntime).GetMethod("Expire", Fields).Invoke(runtime, new object[] { null });
                            else runtime.Dispose();
                            CallerNative.Require(worker.Join(1000));
                        }
                        // The unprivileged fixture refuses acquisition before changing the machine,
                        // then exercises Run's real finally path with its retained exact child.
                        else CallerNative.Require(!runtime.Run(deadline));
                    }
                    finally { runtime.Dispose(); }
                    CallerNative.Require(CallerNative.WaitForSingleObject(exact, 0) == 0);
                    object code = typeof(InstalledOwnerRuntime).GetField("supervisorExitCode", Fields).GetValue(runtime);
                    bool unknown = (bool)typeof(InstalledOwnerRuntime).GetField("cleanupUnknown", Fields).GetValue(runtime);
                    Console.WriteLine("{\"mode\":\"" + mode + "\",\"eofBeforeExit\":true,\"exitCode\":" +
                        (code == null ? "null" : code.ToString()) + ",\"elapsedMs\":" + watch.ElapsedMilliseconds +
                        ",\"cleanupConfirmed\":" + (!unknown ? "true" : "false") + ",\"exactProcessExited\":true}");
                }
            }
        }
        return 0;
    }
}
