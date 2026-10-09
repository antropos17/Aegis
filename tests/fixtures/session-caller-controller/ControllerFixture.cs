using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Aegis.ProtectedSession;

internal static class ControllerFixture
{
    // Preserve the old marshaled schema independently of the production parser's arithmetic.
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSidAttributes { internal IntPtr Sid; internal uint Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeGroups { internal uint Count; internal NativeSidAttributes First; }
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("controller-fixture-control"); }
    private static bool Refused(Action action)
    { try { action(); return false; } catch (InvalidOperationException) { return true; } catch (InvalidDataException) { return true; } }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "held-main") { Thread.Sleep(Timeout.Infinite); return 0; }
        try { Run(args); return 0; } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static void Stop(Process value)
    { if (!value.HasExited) value.Kill(); Require(value.WaitForExit(2000)); }
    private static void Run(string[] args)
    {
        if (args[0] == "identity-abi") { CheckIdentityLayout(); return; }
        string mode = args[0], root = args[1], control = args[2], image = Path.Combine(root, "aegis-session.exe");
        CompositionFiles.WriteRecord(root, image);
        Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CONTROL", control);
        Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_HOLD_WRITER", null);
        bool admitted = false, refused = false, stopped = false, released = false, before = false;
        bool setupRefused = false, created = false, mainLive = false, serverLive = false, replacementLive = false, sharedWrongGate = false;
        int effects = 0;
        using (var self = Process.GetCurrentProcess())
        using (var main = Process.Start(new ProcessStartInfo(typeof(ControllerFixture).Assembly.Location, "held-main") {
            UseShellExecute = false, CreateNoWindow = true }))
        using (var server = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var native = new BootstrapCaptured(false))
        using (var files = new CompositionFiles(root))
        using (var canary = LauncherObservation.Sentinel(Path.Combine(control, "canary.bin")))
        {
            files.BlockRoot = false;
            LauncherObservation.FileInfo info;
            Require(LauncherObservation.GetFileInformationByHandle(canary, out info));
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_HANDLE", canary.DangerousGetHandle().ToInt64().ToString());
            Environment.SetEnvironmentVariable("AEGIS_BOOTSTRAP_FIXTURE_CANARY_ID", info.Identity);
#if CALLER_CONTROLLER_TEST
            using (var registeredMain = CallerRegistration.RegisterMain(main.Handle, server))
#else
            // Baseline uses the preexisting primitive, with no absent-method compilation failure.
            using (var registeredMain = new CallerRegistration(main.Handle, new string('d', 32)))
#endif
            {
                CallerSession owner = null;
                CallerRegistration wrongServer = null, replacement = null;
                try
                {
#if CALLER_CONTROLLER_TEST
                    if (mode == "wrong-server") wrongServer = new CallerRegistration(self.Handle, new string('e', 32));
                    if (mode == "wrong-server-same-gate") wrongServer = CallerRegistration.RegisterMain(self.Handle, server);
                    sharedWrongGate = wrongServer != null && ReferenceEquals(wrongServer.Gate, registeredMain.Gate);
                    if (mode == "main-revoke-before-setup") registeredMain.Dispose();
                    if (mode == "reversed-registration")
                        setupRefused = Refused(() => { using (CallerRegistration.RegisterMain(main.Handle, registeredMain)) { } });
                    else
                    {
                        try { owner = CallerBootstrap.PrepareForControllerTest(root, (int)new FileInfo(image).Length,
                            CompositionFiles.Hash(image), new string('b', 32), wrongServer ?? server, registeredMain, files, native); }
                        catch (InvalidOperationException) { setupRefused = true; }
                    }
#else
                    owner = CallerBootstrap.PrepareForTest(root, (int)new FileInfo(image).Length,
                        CompositionFiles.Hash(image), new string('b', 32), server, files, native);
#endif
                    created = native.Child != null;
                    if (owner != null)
                    {
                    Require(LauncherObservation.SuspendThread(native.Child.Thread) == 1);
                    Require(CallerLauncherNative.ResumeThread(native.Child.Thread) == 2);
                    before = File.Exists(Path.Combine(control, "observed.json")); Require(!before);
                    if (mode == "main-exit-before-release") Stop(main);
                    if (mode == "main-revoke-before-release") registeredMain.Dispose();
                    if (mode == "cancel") { owner.Revoke(); refused = Refused(owner.Release); }
                    else refused = Refused(owner.Release);
                    released = !refused;
                    if (released)
                    {
                        LauncherObservation.Until(() => File.Exists(Path.Combine(control, "observed.json")), "controller-child-ready");
                        if (mode == "main-exit-before-admission") Stop(main);
                        if (mode == "main-revoke-before-admission") registeredMain.Dispose();
                        CallerSession.Context context = null;
                        refused = Refused(() => context = owner.Accept(1000)); admitted = !refused;
                        if (admitted)
                        {
                        if (mode == "main-exit-after-admission") Stop(main);
                        if (mode == "main-revoke-after-admission") registeredMain.Dispose();
#if CALLER_CONTROLLER_TEST
                        if (mode == "main-generation-replacement")
                        {
                            replacement = CallerRegistration.RegisterMain(main.Handle, server);
                            Require(replacement.Generation != registeredMain.Generation);
                            registeredMain.Dispose(); replacement.CheckMain(server);
                            replacementLive = true;
                        }
#endif
                        refused = Refused(context.CheckCurrent);
                        if (!refused) effects++;
                        }
                    }
                    owner.Dispose(); stopped = native.Stopped(); Require(stopped);
                    }
                    else Require(setupRefused && !created);
                    File.WriteAllText(Path.Combine(control, "effect-counter.txt"), effects.ToString());
                    mainLive = !Refused(registeredMain.CheckCurrent); serverLive = !Refused(server.CheckCurrent);
                    Require(new FileInfo(Path.Combine(control, "canary.bin")).Length == 0);
                }
                finally
                {
                    try { if (owner != null) owner.Dispose(); }
                    finally
                    {
                        if (replacement != null) replacement.Dispose();
                        if (wrongServer != null) wrongServer.Dispose();
                        native.CloseObservations(); Stop(main);
                    }
                }
            }
        }
        Console.WriteLine("{\"admitted\":" + admitted.ToString().ToLowerInvariant() + ",\"refused\":" + refused.ToString().ToLowerInvariant() +
            ",\"released\":" + released.ToString().ToLowerInvariant() + ",\"payloadBeforeRelease\":" + before.ToString().ToLowerInvariant() +
            ",\"effects\":" + effects + ",\"stopped\":" + stopped.ToString().ToLowerInvariant() + ",\"created\":" + created.ToString().ToLowerInvariant() +
            ",\"setupRefused\":" + setupRefused.ToString().ToLowerInvariant() + ",\"borrowedMainLive\":" + mainLive.ToString().ToLowerInvariant() +
            ",\"borrowedServerLive\":" + serverLive.ToString().ToLowerInvariant() + ",\"replacementLive\":" + replacementLive.ToString().ToLowerInvariant() +
            ",\"sharedWrongGate\":" + sharedWrongGate.ToString().ToLowerInvariant() + ",\"protectedDescriptorsModeled\":true}");
    }
    private static void CheckIdentityLayout()
    {
        int stride = Marshal.SizeOf(typeof(NativeSidAttributes));
        int offset = Marshal.OffsetOf(typeof(NativeGroups), "First").ToInt32();
        var sid = new System.Security.Principal.SecurityIdentifier("S-1-5-18");
        byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        int length = offset + stride + bytes.Length;
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.Copy(new byte[length], 0, buffer, length);
            Marshal.WriteInt32(buffer, 1);
            IntPtr sidPointer = IntPtr.Add(buffer, offset + stride);
            Marshal.Copy(bytes, 0, sidPointer, bytes.Length);
            Marshal.StructureToPtr(new NativeSidAttributes { Sid = sidPointer, Attributes = 4 }, IntPtr.Add(buffer, offset), false);
            string[] parsed = CallerIdentity.ReadGroups(buffer, length);
            Require(parsed.Length == 1 && parsed[0] == "S-1-5-18:00000004");
            bool shortRefused = Refused(() => CallerIdentity.ReadGroups(buffer, offset + stride - 1));
            Require(shortRefused);
            Console.WriteLine("{\"syntheticBuffers\":true,\"schemaSidBytes\":" + stride + ",\"schemaGroupOffset\":" + offset +
                ",\"nativePointerBytes\":" + IntPtr.Size + ",\"parsedFromMarshaledLayout\":true,\"shortTableRefused\":true}");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
}
