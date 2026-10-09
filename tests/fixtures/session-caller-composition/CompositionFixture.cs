using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Threading;
using Aegis.ProtectedSession;
using Microsoft.Win32.SafeHandles;

internal static class CompositionFixture
{
    private sealed class Captured : CallerLauncherNative, IDisposable
    {
        internal Created Child;
        internal SafeFileHandle Witness, JobWitness;
        internal override Created Create(string image)
        {
            Child = base.Create(image);
            try
            {
                Witness = LauncherObservation.Hold(Child.Pid);
                JobWitness = CallerNative.Duplicate(Child.Job.DangerousGetHandle());
                LauncherObservation.JobAndHandles(Child.Process, Child.Thread, Child.Job);
                return Child;
            }
            catch { try { CallerLauncherNative.Stop(Child); } finally { Child.Dispose(); } throw; }
        }
        public void Dispose()
        { if (JobWitness != null) JobWitness.Dispose(); if (Witness != null) Witness.Dispose(); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Counts
    {
        internal long User, Kernel, PeriodUser, PeriodKernel;
        internal uint Faults, Total, Active, Terminated;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind,
        out Counts value, int size, IntPtr returned);
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("composition-control-failed"); }
    private static bool Refused(Action action)
    {
        try { action(); return false; }
        catch (InvalidOperationException) { return true; }
        catch (InvalidDataException) { return true; }
        catch (TimeoutException) { return true; }
    }
    private static bool Stopped(Captured native)
    {
        Counts value;
        return LauncherObservation.WaitForSingleObject(native.Witness, 2000) == 0 &&
            QueryInformationJobObject(native.JobWitness, 1, out value, Marshal.SizeOf(typeof(Counts)), IntPtr.Zero) && value.Active == 0;
    }
    private static void Setup(string control, CallerSession.RoutingLabels labels)
    {
        File.WriteAllLines(Path.Combine(control, "setup.txt"), new[] {
            labels.Locator, labels.Session, labels.Generation, Process.GetCurrentProcess().Id.ToString()
        });
    }
    private static bool ChangeRoot(string root)
    {
        FileAttributes before = File.GetAttributes(root);
        File.SetAttributes(root, before ^ FileAttributes.Hidden);
        return File.GetAttributes(root) == (before ^ FileAttributes.Hidden);
    }
    private static bool Writable(string path)
    {
        try { using (var writer = File.Open(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { } return true; }
        catch (IOException) { return false; }
    }
    private static SafeFileHandle Pipe(CallerSession owner)
    {
        var endpoint = (CallerEndpoint)typeof(CallerSession).GetField("endpoint", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(owner);
        return (SafeFileHandle)typeof(CallerEndpoint).GetField("pipe", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(endpoint);
    }
    private static bool Concurrent(CallerSession owner, CallerSession.Context context, CompositionFiles files)
    {
        files.BlockRoot = true; Exception readerError = null, revokeError = null;
        using (var finished = new ManualResetEvent(false))
        {
            var reader = new Thread(() => { try { context.CheckCurrent(); } catch (Exception error) { readerError = error; } });
            var revoker = new Thread(() => { try { owner.Revoke(); } catch (Exception error) { revokeError = error; } finally { finished.Set(); } });
            reader.IsBackground = true; revoker.IsBackground = true;
            try
            {
                reader.Start(); Require(files.Entered.WaitOne(1000)); revoker.Start();
                bool serialized = !finished.WaitOne(100); files.Continue.Set();
                Require(reader.Join(4000) && revoker.Join(4000) && readerError == null && revokeError == null);
                return serialized && Refused(context.CheckCurrent);
            }
            finally { files.Continue.Set(); files.BlockRoot = false; }
        }
    }
    private static int Main(string[] args)
    {
        try { Run(args); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static void Run(string[] args)
    {
        string mode = args[0], root = args[1], control = args[2], image = Path.Combine(root, "aegis-session.exe");
        CompositionFiles.WriteRecord(root, image);
        Environment.SetEnvironmentVariable("AEGIS_COMPOSITION_CONTROL", control);
        Environment.SetEnvironmentVariable("AEGIS_COMPOSITION_MODE", mode);
        bool metadataApplied = false, leaseRefused = false, payload = false, stopped = false, beforeRelease = false,
            released = false, accepted = false, contextRefused = false, releaseRefused = false, setupRefused = false,
            admissionRefused = false, duplicateRefused = false, duplicateKeptLive = false, serialized = false,
            endpointClosed = false, pinsHeld = false, pinsReleased = false, descendantStopped = false;
        using (var native = new Captured())
        using (var files = new CompositionFiles(root))
        {
            CallerSession owner = null; SafeFileHandle descendant = null;
            if (mode == "missing-record") File.Delete(Path.Combine(root, "enrollment.json"));
            try
            {
                try
                {
#if ENROLLMENT_LEASE_TEST
                    owner = mode == "strict-root"
                        ? CallerSession.Prepare(root, (int)new FileInfo(image).Length, CompositionFiles.Hash(image), new string('b', 32), native)
                        : CallerSession.PrepareForTest(root, (int)new FileInfo(image).Length, CompositionFiles.Hash(image), new string('b', 32), files, native);
#else
                    Require(mode == "strict-root");
                    owner = CallerSession.Prepare(root, (int)new FileInfo(image).Length,
                        CompositionFiles.Hash(image), new string('b', 32), native);
#endif
                }
                catch (InvalidDataException) { if (mode != "strict-root" && mode != "missing-record") throw; setupRefused = true; }
                if (owner != null)
                {
                    Setup(control, owner.Routing);
                    Require(LauncherObservation.SuspendThread(native.Child.Thread) == 1);
                    Require(CallerLauncherNative.ResumeThread(native.Child.Thread) == 2);
                    Thread.Sleep(100);
                    beforeRelease = File.Exists(Path.Combine(control, "payload.pid"));
                    Require(!beforeRelease && LauncherObservation.WaitForSingleObject(native.Witness, 0) == 0x102);
                    pinsHeld = !Writable(image) && !Writable(Path.Combine(root, "enrollment.json")); Require(pinsHeld);
                    if (mode == "metadata")
                    {
                        metadataApplied = ChangeRoot(root); Require(metadataApplied);
                        try { owner.Release(); }
                        catch (InvalidDataException error) { leaseRefused = error.Message == "enrollment-lease-unavailable"; releaseRefused = true; }
                        Require(leaseRefused && releaseRefused);
                    }
                    else if (mode == "cancel") { owner.Revoke(); releaseRefused = Refused(owner.Release); Require(releaseRefused); }
                    else if (mode == "before-release-admission")
                    { admissionRefused = Refused(() => owner.Accept(100)); Require(admissionRefused); }
                    else if (mode == "closed-endpoint")
                    {
                        var held = Pipe(owner); IntPtr original = held.DangerousGetHandle();
                        ((CallerEndpoint)typeof(CallerSession).GetField("endpoint", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(owner)).Dispose();
                        using (var probe = new SafeFileHandle(original, false))
                        { uint flags; endpointClosed = held.IsClosed && !CallerEndpointNative.GetHandleInformation(probe, out flags); }
                        releaseRefused = Refused(owner.Release); Require(endpointClosed && releaseRefused);
                    }
                    else
                    {
                        owner.Release(); released = true;
                        payload = LauncherObservation.ReadPid(Path.Combine(control, "payload.pid")) == native.Child.Pid; Require(payload);
                        descendant = LauncherObservation.Hold(LauncherObservation.ReadPid(Path.Combine(control, "descendant.pid")));
                        if (mode == "duplicate")
                        {
                            duplicateRefused = Refused(owner.Release);
                            duplicateKeptLive = LauncherObservation.WaitForSingleObject(native.Witness, 0) == 0x102;
                            Require(duplicateRefused && duplicateKeptLive);
                        }
                        if (mode == "admission-timeout")
                        {
                            admissionRefused = Refused(() => owner.Accept(100)); Require(admissionRefused);
                        }
                        else
                        {
                            Require(LauncherObservation.ReadPid(Path.Combine(control, "frame.pid")) == native.Child.Pid);
                            CallerSession.Context context = owner.Accept(1000); context.CheckCurrent();
                            Require(context.RequestId == new string('c', 32)); accepted = true;
                            if (mode == "context-metadata")
                            { metadataApplied = ChangeRoot(root); Require(metadataApplied); contextRefused = Refused(context.CheckCurrent); }
                            else if (mode == "concurrent")
                            { serialized = Concurrent(owner, context, files); contextRefused = serialized; Require(serialized); }
                            else { owner.Revoke(); contextRefused = Refused(context.CheckCurrent); }
                            Require(contextRefused);
                        }
                    }
                    owner.Dispose(); Require(Refused(owner.Release) && Refused(() => owner.Accept(100)));
                }
                else Require(setupRefused);
                stopped = Stopped(native); Require(stopped);
                if (descendant != null)
                { descendantStopped = LauncherObservation.WaitForSingleObject(descendant, 2000) == 0; Require(descendantStopped); }
                payload = File.Exists(Path.Combine(control, "payload.pid"));
                if (!released) Require(!payload);
                pinsReleased = Writable(image) && (mode == "missing-record" || Writable(Path.Combine(root, "enrollment.json"))); Require(pinsReleased);
            }
            finally { if (owner != null) owner.Dispose(); if (descendant != null) descendant.Dispose(); }
        }
        Console.WriteLine("{\"protectedDescriptorsModeled\":" + (mode != "strict-root").ToString().ToLowerInvariant() +
            ",\"testInjectionAbsent\":" + (typeof(CallerSession).GetMethod("PrepareForTest",
                BindingFlags.NonPublic | BindingFlags.Static) == null).ToString().ToLowerInvariant() +
            ",\"metadataApplied\":" + metadataApplied.ToString().ToLowerInvariant() +
            ",\"leaseRefused\":" + leaseRefused.ToString().ToLowerInvariant() + ",\"payload\":" + payload.ToString().ToLowerInvariant() +
            ",\"stopped\":" + stopped.ToString().ToLowerInvariant() + ",\"payloadBeforeRelease\":" + beforeRelease.ToString().ToLowerInvariant() +
            ",\"released\":" + released.ToString().ToLowerInvariant() + ",\"accepted\":" + accepted.ToString().ToLowerInvariant() +
            ",\"contextRefused\":" + contextRefused.ToString().ToLowerInvariant() + ",\"releaseRefused\":" + releaseRefused.ToString().ToLowerInvariant() +
            ",\"setupRefused\":" + setupRefused.ToString().ToLowerInvariant() + ",\"admissionRefused\":" + admissionRefused.ToString().ToLowerInvariant() +
            ",\"duplicateRefused\":" + duplicateRefused.ToString().ToLowerInvariant() + ",\"duplicateKeptLive\":" + duplicateKeptLive.ToString().ToLowerInvariant() +
            ",\"serialized\":" + serialized.ToString().ToLowerInvariant() + ",\"endpointClosed\":" + endpointClosed.ToString().ToLowerInvariant() +
            ",\"pinsHeld\":" + pinsHeld.ToString().ToLowerInvariant() + ",\"pinsReleased\":" + pinsReleased.ToString().ToLowerInvariant() +
            ",\"descendantStopped\":" + descendantStopped.ToString().ToLowerInvariant() + "}");
    }
}
