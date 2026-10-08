using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Aegis.ProtectedSession;

// Disposable executable: owner -> already Job-owned launcher -> actual standard-handle child.
internal static class StdioFixture
{
    private enum Phase { Initialize, Create, Assign, Inventory, Attach, Exchange, Verify, Exit, Cancel, Closure }
    private static Phase phase;
    private static string selectedCase = "Initialize";
    private static CloudGuestStdio.Result lastResult;
    private static CloudGuestStdio.Operation lastOperation;
    private static int lastNativeError, connectedMask;
    private static long elapsed;
    private static bool peerExited, peerExitObserved;
    private static uint peerExitCode;
    private static string inheritedCase = "Absent";
    private static bool inheritedNodeOptions;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct Startup
    {
        internal int Size; internal string Reserved, Desktop, Title;
        internal uint X, Y, XS, YS, XC, YC, Fill, Flags;
        internal ushort Show, Length; internal IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Extended { internal Startup Startup; internal IntPtr List; }
    [StructLayout(LayoutKind.Sequential)] internal struct Info { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User, Job; internal uint Flags; internal IntPtr Min, Max; internal uint Active; internal IntPtr Affinity; internal uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io { internal ulong R, W, O, RB, WB, OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits { internal Basic Basic; internal Io Io; internal IntPtr P, J, PP, PJ; }
    [StructLayout(LayoutKind.Sequential)] internal struct Attributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup startup, out Info process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")] internal static extern bool CreateExtended(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Extended startup, out Info process);
    [DllImport("kernel32.dll")] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int length);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeServerProcessId(System.Runtime.InteropServices.SafeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr CreateEvent(ref Attributes attributes, bool manual, bool initial, string name);
    [DllImport("kernel32.dll")] private static extern bool SetEvent(IntPtr handle);
    internal static void Need(bool value) { if (!value) throw new InvalidOperationException("stdio-fixture-refused"); }
    private static byte[] Input() { var bytes = new byte[8192]; for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)i; return bytes; }
    private static bool Same(byte[] a, byte[] b)
    { if (a.Length != b.Length) return false; for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false; return true; }
    private static byte[] Fill(int count, byte value) { var bytes = new byte[count]; for (int i = 0; i < count; i++) bytes[i] = value; return bytes; }
    private static void Refused(Action action)
    { bool refused = false; try { action(); } catch (InvalidOperationException) { refused = true; } catch (InvalidDataException) { refused = true; } Need(refused); }
    private static void Payload(string mode, IntPtr sentinel)
    {
        // Handle-list exclusion is proved by the owner observing the still-unsignaled event.
        SetEvent(sentinel);
        using (var input = Console.OpenStandardInput()) using (var output = Console.OpenStandardOutput()) using (var error = Console.OpenStandardError())
        {
            if (mode == "hold") { Thread.Sleep(10000); return; }
            if (mode == "cap" || mode == "error-cap") { var stream = mode == "cap" ? output : error; stream.Write(Fill(20000, 79), 0, 20000); stream.Flush(); Thread.Sleep(10000); return; }
            Thread other = null;
            if (mode == "burst")
            {
                other = new Thread(delegate() { error.Write(Fill(48000, 69), 0, 48000); error.Flush(); }); other.Start();
                output.Write(Fill(48000, 79), 0, 48000); output.Flush();
            }
            var expected = Input(); var received = new byte[expected.Length]; int at = 0;
            while (at < received.Length) { int n = input.Read(received, at, received.Length - at); Need(n > 0); at += n; }
            Need(input.ReadByte() == -1 && Same(received, expected));
            output.Write(received, 0, received.Length); output.Flush();
            if (other != null) Need(other.Join(2000));
            else { error.Write(received, 0, received.Length); error.Flush(); }
        }
    }
    private static void Owner(string image, string mode)
    {
        selectedCase = mode; lastResult = null;
        string sid = WindowsIdentity.GetCurrent().User.Value; IntPtr job = IntPtr.Zero; Info child = new Info();
        GuestJobInventory inventory = null; var cancellation = new CancellationTokenSource();
        using (var transport = new CloudGuestStdio(sid))
        {
            try
            {
                job = CreateJobObject(IntPtr.Zero, null); Need(job != IntPtr.Zero);
                var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 4;
                Need(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                phase = Phase.Create; var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)) };
                Need(CreateProcess(image, new StringBuilder("\"" + image + "\" --launcher " + transport.Prefix + " " + Process.GetCurrentProcess().Id + " " + mode), IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, Path.GetDirectoryName(image), ref startup, out child));
                phase = Phase.Assign; Need(AssignProcessToJobObject(job, child.Process));
                phase = Phase.Inventory; inventory = new GuestJobInventory(job, child.Process, new string[] { image });
                if (mode == "echo")
                {
                    using (var wrong = new CloudGuestStdio(sid)) Refused(delegate { wrong.Attach(child.Process, job, Path.Combine(Path.GetDirectoryName(image), "wrong.exe")); });
                    using (var wrong = new CloudGuestStdio("S-1-5-18")) Refused(delegate { wrong.Attach(child.Process, job, image); });
                    IntPtr other = CreateJobObject(IntPtr.Zero, null); Need(other != IntPtr.Zero);
                    try { using (var wrong = new CloudGuestStdio(sid)) Refused(delegate { wrong.Attach(child.Process, other, image); }); }
                    finally { GuestJobNative.CloseHandle(other); }
                }
                phase = Phase.Attach; transport.Attach(child.Process, job, image);
                Refused(delegate { transport.Exchange(null, 65536, 65536, 1000, CancellationToken.None); });
                Need(ResumeThread(child.Thread) == 1);
                if (mode == "hold") cancellation.CancelAfter(200);
                if (mode == "wrong-peer")
                {
                    using (var peer = new NamedPipeClientStream(".", transport.Prefix + "-0", PipeDirection.In))
                    {
                        peer.Connect(1000); bool refused = false;
                        try { transport.Exchange(Input(), 65536, 65536, 1000, CancellationToken.None); }
                        catch (InvalidOperationException) { refused = true; }
                        Need(refused);
                    }
                }
                else
                {
                    phase = Phase.Exchange; CloudGuestStdio.Result result;
                    try { result = transport.Exchange(Input(), mode == "cap" ? 1024 : 65536, mode == "error-cap" ? 1024 : 65536, mode == "deadline" ? 100 : 5000, cancellation.Token); }
                    finally { lastOperation = transport.LastOperation; lastNativeError = transport.LastNativeError; elapsed = transport.ExchangeElapsedMilliseconds; connectedMask = transport.ConnectedMask; peerExited = GuestJobNative.WaitForSingleObject(child.Process, 0) == 0; peerExitObserved = peerExited && GetExitCodeProcess(child.Process, out peerExitCode); }
                    lastResult = result;
                    if (mode == "echo" || mode == "node") Need(result.Outcome == CloudGuestStdio.Outcome.Complete && result.InputEof && result.OutputEof && result.ErrorEof && Same(result.Output, Input()) && Same(result.Error, Input()));
                    else if (mode == "burst")
                    {
                        var expected = new byte[56192]; Buffer.BlockCopy(Fill(48000, 79), 0, expected, 0, 48000); Buffer.BlockCopy(Input(), 0, expected, 48000, 8192);
                        Need(result.Outcome == CloudGuestStdio.Outcome.Complete && Same(result.Output, expected) && Same(result.Error, Fill(48000, 69)) && result.InputEof && result.OutputEof && result.ErrorEof);
                    }
                    else if (mode == "cap") Need(result.Outcome == CloudGuestStdio.Outcome.OutputLimit && result.Output.Length <= 1024 && result.Error.Length <= 65536);
                    else if (mode == "error-cap") Need(result.Outcome == CloudGuestStdio.Outcome.OutputLimit && result.Error.Length <= 1024 && result.Output.Length <= 65536);
                    else if (mode == "hold") Need(result.Outcome == CloudGuestStdio.Outcome.Cancelled && GuestJobNative.WaitForSingleObject(child.Process, 0) == 0x102);
                    else Need(mode == "deadline" && result.Outcome == CloudGuestStdio.Outcome.Deadline);
                }
                phase = Phase.Verify; bool normal = mode == "echo" || mode == "burst" || mode == "node";
                if (normal) { uint code; Need(GuestJobNative.WaitForSingleObject(child.Process, 2000) == 0 && GetExitCodeProcess(child.Process, out code) && code == 0); }
                var retained = new System.Collections.Generic.List<IntPtr>();
                try
                {
                    if (mode == "hold")
                    {
                        var before = GuestJobNative.Counts(job); uint[] members = GuestJobNative.Members(job); int payloads = 0, conhosts = 0;
                        Need(before.Active >= 2 && before.Active <= 4 && before.Total == before.Active && members.Length == before.Active);
                        foreach (uint member in members)
                        {
                            IntPtr held = GuestJobNative.OpenMember(member); retained.Add(held);
                            Need(GuestJobNative.Birth(held, job, member) > 0 && GuestJobNative.Principal(held) == sid);
                            string observed = GuestJobNative.Image(held);
                            if (String.Equals(observed, image, StringComparison.OrdinalIgnoreCase)) { if (member != child.Pid) payloads++; }
                            else { Need(String.Equals(observed, Path.Combine(Environment.SystemDirectory, "conhost.exe"), StringComparison.OrdinalIgnoreCase)); conhosts++; }
                        }
                        var after = GuestJobNative.Counts(job); uint[] observedMembers = GuestJobNative.Members(job);
                        Need(payloads == 1 && before.Total == after.Total && before.Active == after.Active && members.Length == observedMembers.Length);
                        for (int at = 0; at < members.Length; at++) Need(members[at] == observedMembers[at]);
                        Console.WriteLine("native-stdio-held-census:members=" + members.Length + ";payload=1;exactSystemConhost=" + conhosts);
                    }
                    phase = Phase.Closure; Need(TerminateJobObject(job, 137) && inventory.ConfirmClosure(2000));
                    foreach (IntPtr held in retained) Need(GuestJobNative.WaitForSingleObject(held, 0) == 0);
                }
                finally { foreach (IntPtr held in retained) GuestJobNative.CloseHandle(held); }
                Refused(delegate { transport.Exchange(Input(), 65536, 65536, 1000, CancellationToken.None); });
                Console.WriteLine("native-stdio-" + mode + ":passed");
            }
            finally
            {
                cancellation.Dispose();
                if (job != IntPtr.Zero) { Need(TerminateJobObject(job, 137)); if (inventory != null) { Need(inventory.ConfirmClosure(2000)); inventory.Dispose(); } }
                if (child.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(child.Thread);
                if (child.Process != IntPtr.Zero) GuestJobNative.CloseHandle(child.Process);
                if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
            }
        }
    }
    private static int Main(string[] args)
    {
        try
        {
            string image = Process.GetCurrentProcess().MainModule.FileName;
            if (args.Length == 4 && args[0] == "--launcher")
            {
                string mode = args[3]; Need(mode == "echo" || mode == "burst" || mode == "cap" || mode == "error-cap" || mode == "hold" || mode == "deadline" || mode == "wrong-peer" || mode == "node");
                if (mode == "wrong-peer") { Thread.Sleep(10000); return 0; }
                if (mode == "node") return CloudGuestStdioLauncher.RunFixed(args[1], uint.Parse(args[2]), Environment.GetEnvironmentVariable("AEGIS_STDIO_FIXTURE_NODE"),
                    "\"" + Environment.GetEnvironmentVariable("AEGIS_STDIO_FIXTURE_TASK") + "\"", Path.GetDirectoryName(image), false);
                return CloudGuestStdioLauncher.RunFixed(args[1], uint.Parse(args[2]), image, "--payload " + (mode == "deadline" ? "hold" : mode), Path.GetDirectoryName(image), true);
            }
            if (args.Length == 3 && args[0] == "--payload") { Payload(args[1], new IntPtr(long.Parse(args[2]))); return 0; }
            Need((args.Length == 2 || (args.Length == 3 && args[2] == "--single-node")) && Path.IsPathRooted(args[0]) && Path.IsPathRooted(args[1]));
            string inherited = Environment.GetEnvironmentVariable("AEGIS_STDIO_CASE");
            inheritedCase = String.IsNullOrEmpty(inherited) ? "Absent" : (inherited.Length == 1 && inherited[0] >= '1' && inherited[0] <= '5' ? inherited : "Other");
            inheritedNodeOptions = !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("NODE_OPTIONS"));
            Environment.SetEnvironmentVariable("AEGIS_STDIO_CASE", "1");
            Environment.SetEnvironmentVariable("AEGIS_STDIO_FIXTURE_NODE", args[0]);
            Environment.SetEnvironmentVariable("AEGIS_STDIO_FIXTURE_TASK", args[1]);
            Owner(image, "node");
            if (args.Length == 3) return 0;
            foreach (string mode in new string[] { "echo", "burst", "cap", "error-cap", "hold", "deadline", "wrong-peer" }) Owner(image, mode);
            return 0;
        }
        catch (Exception failure) { Console.Error.WriteLine("stdio-fixture-case:" + selectedCase); Console.Error.WriteLine("stdio-fixture-environment:case=" + inheritedCase + ";nodeOptions=" + inheritedNodeOptions); Console.Error.WriteLine("stdio-fixture-operation:" + lastOperation + ";nativeError=" + lastNativeError); Console.Error.WriteLine("stdio-fixture-state:elapsed=" + elapsed + ";connectedMask=" + connectedMask + ";peerExited=" + peerExited + ";peerExitObserved=" + peerExitObserved + ";peerExitCode=" + peerExitCode); Console.Error.WriteLine("stdio-fixture-exception:" + (failure is InvalidDataException ? "Identity" : failure is InvalidOperationException ? "Invariant" : "Other") + ";hresult=" + failure.HResult); if (lastResult != null) Console.Error.WriteLine("stdio-fixture-result:" + lastResult.Outcome + ";input=" + lastResult.InputBytes + ";output=" + lastResult.Output.Length + ";error=" + lastResult.Error.Length + ";inputEof=" + lastResult.InputEof + ";outputEof=" + lastResult.OutputEof + ";errorEof=" + lastResult.ErrorEof); Console.Error.WriteLine("stdio-fixture-phase:" + phase); Console.Error.WriteLine("stdio-fixture-refused"); return 1; }
    }
}
