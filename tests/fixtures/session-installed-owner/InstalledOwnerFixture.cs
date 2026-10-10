using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Aegis.ProtectedSession;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Fixture-only native producer. This method is absent from all production outputs.
    internal partial class CallerLauncherNative
    {
        internal Created CreateUntrustedInstalled(string image, SafeFileHandle input, SafeFileHandle output)
        { return CreateCore(image, input, output, null, "--installed-owner-session"); }
    }
}

internal static class InstalledOwnerFixture
{
    // Disposable anonymous pipes exercise the maintained parser without creating
    // an installed registration, service, account or production owner runtime.
    private static string ReadFailure(string frame, bool split)
    {
        using (var pipe = new InstalledOwnerPipe(false))
        {
            var deadline = new InstalledOwnerDeadline(2000);
            InstalledOwnerPipe.Send(pipe.Write, Encoding.ASCII.GetBytes(frame), deadline);
            string value = Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(pipe.Read, split ? 16 : frame.Length, deadline));
            if (split) value += Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(pipe.Read, frame.Length - 16, deadline));
            return value;
        }
    }
    private static string Frame(uint stage, uint substage)
    { return "AEGISF02" + stage.ToString("x8") + substage.ToString("x8") + new string('0', 80); }
    private static string Parsed(string frame, bool split)
    {
        uint stage, substage; bool accepted = InstalledOwnerSession.TryReadFailureFrame(ReadFailure(frame, split), out stage, out substage);
        return "{\"accepted\":" + (accepted ? "true" : "false") + ",\"stage\":" + stage + ",\"substage\":" + substage + "}";
    }
    private static int FailureFrames()
    {
        var rows = new List<string>();
        for (uint stage = 1; stage <= 12; stage++)
            rows.Add("{\"kind\":\"legacy\",\"expectedStage\":" + stage + ",\"expectedSubstage\":0,\"whole\":" + Parsed(Frame(stage, 0), false) + ",\"split\":" + Parsed(Frame(stage, 0), true) + "}");
        for (uint substage = 1; substage <= 13; substage++)
            rows.Add("{\"kind\":\"stage2\",\"expectedStage\":2,\"expectedSubstage\":" + substage + ",\"whole\":" + Parsed(Frame(2, substage), false) + ",\"split\":" + Parsed(Frame(2, substage), true) + "}");
        string[] invalid = { Frame(0, 0), Frame(13, 0), Frame(2, 14), Frame(1, 1), Frame(3, 13),
            Frame(2, 8).Substring(0, 103) + "1", Frame(2, 8).Replace("00000008", "0000000A"),
            "AEGISF03" + Frame(2, 8).Substring(8), Frame(2, 8).Substring(0, 103), Frame(2, 8) + "0" };
        for (int index = 0; index < invalid.Length; index++)
            rows.Add("{\"kind\":\"invalid\",\"index\":" + index + ",\"whole\":" + Parsed(invalid[index], false) + ",\"split\":" + Parsed(invalid[index], true) + "}");
        byte[] issued = InstalledOwnerSession.FailureFrame(2, 8); uint writerStage, writerSubstage;
        bool writerAccepted = InstalledOwnerSession.TryReadFailureFrame(Encoding.ASCII.GetString(issued), out writerStage, out writerSubstage);
        Console.WriteLine("{\"frameBytes\":" + issued.Length + ",\"writer\":{\"accepted\":" + (writerAccepted ? "true" : "false") +
            ",\"stage\":" + writerStage + ",\"substage\":" + writerSubstage + "},\"parsed\":" + Parsed(Frame(2, 8), false) +
            ",\"rows\":[" + String.Join(",", rows) + "]}");
        return 0;
    }
    private static string Observation(SafeFileHandle handle)
    {
        long birth, exit, kernel, user;
        CallerNative.Require(CallerNative.GetProcessTimes(handle, out birth, out exit, out kernel, out user));
        return CallerNative.GetProcessId(handle).ToString("x8") + birth.ToString("x16");
    }
    private static int Main(string[] arguments)
    {
        if (arguments.Length == 1 && arguments[0] == "--failure-frames") return FailureFrames();
        if (arguments.Length == 1 && arguments[0] == "--child") { System.Threading.Thread.Sleep(20000); return 0; }
        if (arguments.Length != 3) return 2;
        CallerLauncherNative.Created child = null, main = null; bool cleanup = false; int stage = 0;
        using (var canary = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var input = new InstalledOwnerPipe(false))
        using (var output = new InstalledOwnerPipe(true))
        using (var self = CallerNative.DuplicateSelf())
        {
            try
            {
                var native = new CallerLauncherNative();
                stage = 1;
                child = native.CreateUntrustedInstalled(arguments[0], input.Read, output.Write);
                // The untrusted current-user producer retains a real created second root in its own Job.
                stage = 2; main = native.Create(System.Reflection.Assembly.GetExecutingAssembly().Location);
                stage = 3; CallerLauncherNative.CheckCreated(child); CallerLauncherNative.CheckCreated(main);
                input.Read.Dispose(); output.Write.Dispose();
                IntPtr owner = InstalledOwnerPipe.Reduce(self, child.Process, 0x00101000);
                IntPtr job = InstalledOwnerPipe.Reduce(child.Job, child.Process, 4);
                IntPtr controller = InstalledOwnerPipe.Reduce(main.Process, child.Process, 0x00101000);
                string frame = "AEGISO02" + owner.ToInt64().ToString("x16") + job.ToInt64().ToString("x16") + controller.ToInt64().ToString("x16") +
                    new string('0', 16) + Observation(self) + Observation(child.Process) + Observation(main.Process) +
                    new string('a', 32) + new string('b', 32) + new string('c', 32) + "00000001";
                CallerNative.Require(frame.Length == InstalledOwnerBootstrap.Size);
                var deadline = new InstalledOwnerDeadline(12000);
                InstalledOwnerPipe.Send(input.Write, Encoding.ASCII.GetBytes(frame), deadline);
                if (arguments[1] != "missing-eof") input.Write.Dispose();
                File.WriteAllText(Path.Combine(arguments[2], "producer-ready.txt"), "original-query-handles-created-and-job-bound");
                stage = 4; CallerNative.Require(CallerLauncherNative.ResumeThread(child.Thread) == 1);
                CallerNative.Require(CallerNative.WaitForSingleObject(child.Process, 11500) == 0);
                uint code; CallerNative.Require(GetExitCodeProcess(child.Process, out code) && code == 2);
                stage = 5; CallerLauncherNative.Stop(child); CallerLauncherNative.Stop(main);
                cleanup = GuestJobNative.Counts(child.Job.DangerousGetHandle()).Active == 0 && GuestJobNative.Counts(main.Job.DangerousGetHandle()).Active == 0;
                CallerNative.Require(cleanup && !canary.HasExited);
                File.WriteAllText(Path.Combine(arguments[2], "effect-counter.txt"), "0");
                Console.WriteLine("{\"refused\":true,\"effects\":0,\"producerReady\":true,\"ownedJobsEmpty\":true,\"unrelatedCanarySurvived\":true}"); return 0;
            }
            catch { Console.WriteLine("{\"fixtureFailureStage\":" + stage + ",\"nativeError\":" + Marshal.GetLastWin32Error() + "}"); return 2; }
            finally
            {
                if (!cleanup) { if (main != null) try { CallerLauncherNative.Stop(main); } catch { } if (child != null) try { CallerLauncherNative.Stop(child); } catch { } }
                if (main != null) main.Dispose(); if (child != null) child.Dispose();
                if (!canary.HasExited) canary.Kill(); canary.WaitForExit(2000);
            }
        }
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
}
