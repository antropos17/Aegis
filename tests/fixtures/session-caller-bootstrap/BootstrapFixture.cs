using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Aegis.ProtectedSession;

internal static class BootstrapFixture
{
    private static void Require(bool condition) { if (!condition) throw new InvalidOperationException("bootstrap-fixture-control"); }
    private static bool Refused(Action action)
    {
        try { action(); return false; }
        catch (InvalidOperationException) { return true; }
        catch (InvalidDataException) { return true; }
        catch (TimeoutException) { return true; }
    }
    private static string ReadClosedText(string path)
    {
        if (Environment.GetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_HOLD_WRITER") == "1")
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(path), "parent-read-attempted"), "ready");
        string value = null;
        LauncherObservation.Until(() => {
            try { value = File.ReadAllText(path); return true; }
            catch (IOException error)
            {
                int code = error.HResult & 0xffff;
                if (code == 32 || code == 33) return false;
                throw;
            }
        }, "bootstrap-observation-read-timeout");
        return value;
    }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "sibling") { Thread.Sleep(Timeout.Infinite); return 0; }
        try { Run(args); return 0; } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static void Run(string[] args)
    {
        string mode = args[0], root = args[1], control = args[2], image = Path.Combine(root, "aegis-session.exe");
        CompositionFiles.WriteRecord(root, image);
        Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CONTROL", control);
        Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_HOLD_WRITER", mode == "observation-held-writer" ? "1" : null);
        bool mutate = mode != "positive" && mode != "cancel" && mode != "duplicate" && mode != "server-revoke" &&
            mode != "context-server-revoke" && mode != "context-revoke" && mode != "wrong-server" && mode != "missing-record" &&
            mode != "observation-held-writer";
        bool accepted = false, rejected = false, before = false, stopped = false, payload = false, rights = false,
            contextRefused = false, releaseRefused = false, duplicateKeptLive = false, setupRefused = false,
            readerClosed = false, writerHeldAtRefusal = false, canaryExcluded = false;
        int rejectionStep = -1; long elapsed = 0;
        using (var self = Process.GetCurrentProcess())
        using (var sibling = Process.Start(new ProcessStartInfo(typeof(BootstrapFixture).Assembly.Location, "sibling") {
            UseShellExecute = false, CreateNoWindow = true }))
        using (var native = new BootstrapCaptured(mutate))
        using (var files = new CompositionFiles(root))
        using (var canary = LauncherObservation.Sentinel(Path.Combine(control, "canary.bin")))
        using (var server = new CallerRegistration(mode == "wrong-server" ? sibling.Handle : self.Handle, new string('a', 32)))
        {
            files.BlockRoot = false;
            LauncherObservation.FileInfo canaryInfo;
            Require(LauncherObservation.GetFileInformationByHandle(canary, out canaryInfo));
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_HANDLE", canary.DangerousGetHandle().ToInt64().ToString());
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_ID", canaryInfo.Identity);
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_LOCATOR", "\\\\foreign\\pipe\\fake");
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_SERVER_PID", sibling.Id.ToString());
            CallerSession owner = null;
            try
            {
                if (mode == "missing-record") File.Delete(Path.Combine(root, "enrollment.json"));
                try
                {
                    owner = CallerBootstrap.PrepareForTest(root, (int)new FileInfo(image).Length,
                        CompositionFiles.Hash(image), new string('b', 32), server, files, native);
                }
                catch (InvalidDataException) { if (mode != "missing-record") throw; setupRefused = true; }
                if (owner != null)
                {
                    Require(LauncherObservation.SuspendThread(native.Child.Thread) == 1);
                    Require(CallerLauncherNative.ResumeThread(native.Child.Thread) == 2);
                    Thread.Sleep(50);
                    before = File.Exists(Path.Combine(control, "observed.json")); Require(!before);
                    if (mutate)
                    {
                        using (var borrowed = new Microsoft.Win32.SafeHandles.SafeFileHandle(sibling.Handle, false)) native.Rewrite(mode, borrowed);
                        readerClosed = native.Reader.IsClosed;
                    }
                    if (mode == "cancel") { owner.Revoke(); releaseRefused = Refused(owner.Release); }
                    else if (mode == "server-revoke") { server.Dispose(); releaseRefused = Refused(owner.Release); }
                    else
                    {
                        owner.Release();
                        if (mode == "no-eof-cancel")
                        {
                            Require(LauncherObservation.ReadPid(Path.Combine(control, "receiver-entered.pid")) == native.Child.Pid);
                            Thread.Sleep(30); owner.Revoke();
                            releaseRefused = Refused(owner.Release); writerHeldAtRefusal = !native.Writer.IsClosed;
                        }
                        else
                        {
                        if (mode == "duplicate")
                        {
                            releaseRefused = Refused(owner.Release);
                            duplicateKeptLive = LauncherObservation.WaitForSingleObject(native.Witness, 0) == 0x102;
                            Require(releaseRefused && duplicateKeptLive);
                        }
                        LauncherObservation.Until(() => File.Exists(Path.Combine(control, "observed.json")), "bootstrap-child-ready");
                        string observation = ReadClosedText(Path.Combine(control, "observed.json"));
                        payload = observation.Contains("\"payload\":true"); rights = observation.Contains("\"rightsReduced\":true");
                        canaryExcluded = observation.Contains("\"canaryExcluded\":true");
                        rejected = observation.Contains("\"rejected\":true");
                        if (rejected)
                        {
                            string[] phase = ReadClosedText(Path.Combine(control, "refusal.txt")).Split('\n');
                            rejectionStep = int.Parse(phase[0].Substring(5)); elapsed = long.Parse(phase[1].Substring(8));
                            writerHeldAtRefusal = native.Writer != null && !native.Writer.IsClosed;
                            Require(Refused(() => owner.Accept(100)));
                        }
                        else if (mode == "session-substitution" || mode == "generation-substitution")
                        { rejected = Refused(() => owner.Accept(1000)); Require(rejected); }
                        else
                        {
                            var context = owner.Accept(1000); context.CheckCurrent(); accepted = true;
                            Require(context.RequestId == new string('c', 32));
                            if (mode == "context-server-revoke") server.Dispose(); else owner.Revoke();
                            contextRefused = Refused(context.CheckCurrent); Require(contextRefused);
                        }
                        }
                    }
                    owner.Dispose(); Require(Refused(owner.Release) && Refused(() => owner.Accept(100)));
                }
                else Require(setupRefused);
                stopped = native.Stopped(); Require(stopped);
                Require(new FileInfo(Path.Combine(control, "canary.bin")).Length == 0);
                if (mode == "cancel" || mode == "server-revoke" || mode == "missing-record" || mode == "no-eof-cancel") Require(!File.Exists(Path.Combine(control, "observed.json")));
            }
            finally
            {
                try { if (owner != null) owner.Dispose(); }
                finally
                {
                    native.CloseObservations();
                    if (!sibling.HasExited) sibling.Kill(); Require(sibling.WaitForExit(2000));
                }
            }
        }
        string[] names = "accepted,payload,rejected,payloadBeforeRelease,stopped,rightsReduced,canaryExcluded,contextRefused,releaseRefused,duplicateKeptLive,setupRefused,readerClosedBeforeRelease,writerHeldAtRefusal".Split(',');
        bool[] values = { accepted, payload, rejected, before, stopped, rights, canaryExcluded, contextRefused, releaseRefused,
            duplicateKeptLive, setupRefused, readerClosed, writerHeldAtRefusal };
        Console.Write("{\"protectedDescriptorsModeled\":true");
        for (int index = 0; index < names.Length; index++) Console.Write(",\"" + names[index] + "\":" + (values[index] ? "true" : "false"));
        Console.WriteLine(",\"rejectionStep\":" + rejectionStep + ",\"elapsed\":" + elapsed + "}");
    }
}
