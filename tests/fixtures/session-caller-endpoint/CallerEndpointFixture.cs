using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class CallerEndpointFixture
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(SafeHandle handle, int type, uint information,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeInfo(SafeHandle handle, out uint flags, out uint output, out uint input, out uint instances);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int length, out int returned);
    [DllImport("kernel32.dll", EntryPoint = "CreateNamedPipeW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle RawPipe(string name, uint open, uint mode, uint instances, uint output, uint input, uint timeout, IntPtr security);
    [DllImport("kernel32.dll", EntryPoint = "GetHandleInformation", SetLastError = true)]
    private static extern bool RawHandleInformation(IntPtr handle, out uint flags);

    private static bool Closed(SafeFileHandle handle, IntPtr original)
    {
        uint flags;
        return handle.IsClosed && !RawHandleInformation(original, out flags) && Marshal.GetLastWin32Error() == 6;
    }

    private static string IndependentLogonSid()
    {
        using (var identity = WindowsIdentity.GetCurrent())
        {
            int size;
            GetTokenInformation(identity.Token, 28, IntPtr.Zero, 0, out size);
            CallerNative.Require(size > 0 && size <= 65536);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                int returned;
                CallerNative.Require(GetTokenInformation(identity.Token, 28, buffer, size, out returned) && Marshal.ReadInt32(buffer) == 1);
                return new SecurityIdentifier(Marshal.ReadIntPtr(buffer, IntPtr.Size == 8 ? 8 : 4)).Value;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    private static Process StartChild(string mode = "child")
    {
        return Process.Start(new ProcessStartInfo {
            FileName = typeof(CallerEndpointFixture).Assembly.Location, Arguments = mode, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        });
    }

    private static void Stop(Process child)
    {
        if (child == null) return;
        try { if (!child.HasExited) child.Kill(); CallerNative.Require(child.WaitForExit(2000)); }
        finally { child.Dispose(); }
    }

    private static void Supply(Process child, CallerEndpoint endpoint, CallerRegistration peer, IntPtr serverHandle)
    {
        IntPtr imported;
        CallerNative.Require(DuplicateHandle(CallerEndpointNative.GetCurrentProcess(), serverHandle,
            child.Handle, out imported, 0, false, 2));
        // Fixture-only trusted bootstrap delivers a native handle duplicated into this exact launched child.
        // Its numeric value and the locator never enter the inspect frame or establish identity there.
        child.StandardInput.WriteLine(imported.ToInt64());
        child.StandardInput.WriteLine(endpoint.LocalLocator);
        child.StandardInput.WriteLine(peer.Session);
        child.StandardInput.WriteLine(peer.Generation);
        child.StandardInput.Flush();
    }

    private static int Child(string mode)
    {
        using (var imported = new SafeFileHandle(new IntPtr(long.Parse(Console.ReadLine())), true))
        {
            string locator = Console.ReadLine(), session = Console.ReadLine(), generation = Console.ReadLine();
            using (var server = new CallerRegistration(imported.DangerousGetHandle(), session))
            {
                try
                {
                    if (mode == "scheduled-child")
                    {
                        Console.WriteLine("bootstrap-ready"); Console.Out.Flush();
                        CallerNative.Require(Console.ReadLine() == "connect");
                    }
                    using (var client = CallerEndpoint.ConnectLocal(locator, server, 1000))
                    {
                        uint flags;
                        CallerNative.Require(CallerEndpointNative.GetHandleInformation(client, out flags) && (flags & 1) == 0);
                        if (mode == "silent-child")
                        {
                            // Readiness follows actual connection and independent server verification.
                            // The parent controls this pipe's lifetime; no message or EOF races admission.
                            Console.WriteLine("connected-noninherited-verified-no-frame"); Console.Out.Flush();
                            CallerNative.Require(Console.ReadLine() == "close-without-frame");
                            return 0;
                        }
                        if (mode == "scheduled-child")
                        {
                            Console.WriteLine("connected-noninherited-verified-no-frame"); Console.Out.Flush();
                            CallerNative.Require(Console.ReadLine() == "send");
                        }
                        string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"operation\":\"inspect-owned\"," +
                            "\"requestId\":\"" + new string('a', 32) + "\",\"sessionId\":\"" + session +
                            "\",\"generation\":\"" + generation + "\",\"sequence\":1}";
                        byte[] bytes = Encoding.UTF8.GetBytes(json), frame = new byte[bytes.Length + 4];
                        Buffer.BlockCopy(BitConverter.GetBytes(bytes.Length), 0, frame, 0, 4);
                        Buffer.BlockCopy(bytes, 0, frame, 4, bytes.Length);
                        uint written;
                        CallerNative.Require(CallerEndpointNative.WriteFile(client, frame, (uint)frame.Length, out written, IntPtr.Zero) && written == frame.Length);
                        Console.WriteLine("written-noninherited-verified"); Console.Out.Flush();
                        CallerNative.Require(Console.ReadLine() == "release");
                    }
                }
                catch (InvalidOperationException) { Console.WriteLine("server-denied"); }
            }
        }
        return 0;
    }

    private static SafeFileHandle Pipe(CallerEndpoint endpoint)
    {
        return (SafeFileHandle)typeof(CallerEndpoint).GetField("pipe", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(endpoint);
    }

    private static string ReadReady(Process child)
    {
        var ready = child.StandardOutput.ReadLineAsync();
        CallerNative.Require(ready.Wait(3000)); return ready.Result;
    }

    // Explicit protocol phase checkpoint, measured independently of the subject budget.
    private static void Checkpoint(Stopwatch watch, int milliseconds)
    {
        using (var never = new ManualResetEvent(false))
            while (true)
            {
                long remaining = milliseconds - watch.ElapsedMilliseconds;
                if (remaining <= 0) return;
                never.WaitOne((int)remaining);
            }
    }

    private sealed class AuthenticationBarrier : CallerNative, IDisposable
    {
        private readonly bool afterRevert;
        internal readonly ManualResetEvent Entered = new ManualResetEvent(false), Continue = new ManualResetEvent(false);
        internal bool Impersonated, Reverted;
        internal AuthenticationBarrier(bool selected) { afterRevert = selected; }
        private void Hold() { Entered.Set(); CallerNative.Require(Continue.WaitOne(4000)); }
        internal override SafeFileHandle ThreadToken()
        {
            SafeFileHandle token = base.ThreadToken();
            try { Impersonated = CallerNative.HasThreadToken(); if (!afterRevert) Hold(); return token; }
            catch { token.Dispose(); throw; }
        }
        internal override bool Revert()
        {
            bool result = base.Revert(); Reverted = result && !CallerNative.HasThreadToken();
            if (afterRevert) Hold(); return result;
        }
        public void Dispose() { Continue.Set(); Entered.Dispose(); Continue.Dispose(); }
    }

    private static void AuthenticationDeadline(string mode, Process child, CallerEndpoint endpoint, CallerRegistration peer, IntPtr server)
    {
        Supply(child, endpoint, peer, server);
        CallerNative.Require(ReadReady(child) == "written-noninherited-verified");
        uint pid, available, left;
        CallerNative.Require(CallerNative.GetNamedPipeClientProcessId(Pipe(endpoint), out pid) && pid == child.Id &&
            CallerNative.PeekNamedPipe(Pipe(endpoint), IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == left && left > 4);
        bool accepted = false, timedOut = false, clean = false, entered = false, impersonated = false, reverted = false;
        IntPtr original = Pipe(endpoint).DangerousGetHandle();
        if (mode == "buffered-expired")
        {
            var budget = new CallerAdmissionBudget(100); var clock = Stopwatch.StartNew();
            Checkpoint(clock, 250);
            try { CallerAdmission.ReadAndAuthenticate(Pipe(endpoint), peer, new CallerNative(), budget); accepted = true; }
            catch (TimeoutException) { timedOut = true; }
            clean = !CallerNative.HasThreadToken();
        }
        else using (var native = new AuthenticationBarrier(mode == "auth-revert-deadline"))
        {
            Exception failure = null;
            var budget = new CallerAdmissionBudget(1000); var clock = Stopwatch.StartNew();
            var attempt = new Thread(() => {
                try { CallerAdmission.ReadAndAuthenticate(Pipe(endpoint), peer, native, budget); accepted = true; }
                catch (TimeoutException) { timedOut = true; }
                catch (Exception error) { failure = error; }
                finally { clean = !CallerNative.HasThreadToken(); }
            });
            attempt.IsBackground = true; attempt.Start();
            try { entered = native.Entered.WaitOne(2000); CallerNative.Require(entered); Checkpoint(clock, 1250); }
            finally { native.Continue.Set(); CallerNative.Require(attempt.Join(3000)); }
            CallerNative.Require(failure == null);
            impersonated = native.Impersonated; reverted = native.Reverted;
        }
        bool alive = !child.HasExited; endpoint.Dispose();
        bool closed = Closed(Pipe(endpoint), original);
        child.StandardInput.WriteLine("release"); child.StandardInput.Flush();
        CallerNative.Require(child.WaitForExit(2000) && child.ExitCode == 0 && child.StandardError.ReadToEnd().Length == 0);
        Console.WriteLine("{\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"timedOut\":" + timedOut.ToString().ToLowerInvariant() +
            ",\"validFrameQueued\":true,\"peerAlive\":" + alive.ToString().ToLowerInvariant() + ",\"closedByFixture\":" + closed.ToString().ToLowerInvariant() +
            ",\"barrierEntered\":" + entered.ToString().ToLowerInvariant() + ",\"impersonated\":" + impersonated.ToString().ToLowerInvariant() +
            ",\"reverted\":" + reverted.ToString().ToLowerInvariant() + ",\"threadUnimpersonated\":" + clean.ToString().ToLowerInvariant() + "}");
    }

    private static void AggregateDeadline(Process child, CallerEndpoint endpoint, CallerRegistration peer, IntPtr server, bool withinBudget)
    {
        Supply(child, endpoint, peer, server); CallerNative.Require(ReadReady(child) == "bootstrap-ready");
        bool accepted = false, timedOut = false, clean = false; Exception failure = null;
        IntPtr original = Pipe(endpoint).DangerousGetHandle();
        using (var started = new ManualResetEvent(false))
        {
            Stopwatch clock = null;
            var attempt = new Thread(() => {
                clock = Stopwatch.StartNew(); started.Set();
                try { var context = endpoint.Accept(1000); context.CheckCurrent(); accepted = true; }
                catch (TimeoutException) { timedOut = true; }
                catch (Exception error) { failure = error; }
                finally { clean = !CallerNative.HasThreadToken(); }
            });
            attempt.IsBackground = true; attempt.Start();
            bool connectedBeforeExpiry = false, frameAfterExpiry = false;
            string observation = null;
            try
            {
                CallerNative.Require(started.WaitOne(1000)); Checkpoint(clock, 350);
                child.StandardInput.WriteLine("connect"); child.StandardInput.Flush();
                CallerNative.Require(ReadReady(child) == "connected-noninherited-verified-no-frame");
                uint pid, available, left;
                connectedBeforeExpiry = clock.ElapsedMilliseconds < 1000;
                CallerNative.Require(connectedBeforeExpiry && !child.HasExited &&
                    CallerNative.GetNamedPipeClientProcessId(Pipe(endpoint), out pid) && pid == child.Id &&
                    CallerNative.PeekNamedPipe(Pipe(endpoint), IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == 0);
                Checkpoint(clock, withinBudget ? 550 : 1300); frameAfterExpiry = clock.ElapsedMilliseconds >= 1000;
                child.StandardInput.WriteLine("send"); child.StandardInput.Flush();
                observation = ReadReady(child);
                CallerNative.Require(observation == "written-noninherited-verified" || observation == "server-denied");
            }
            finally { CallerNative.Require(attempt.Join(4000)); }
            CallerNative.Require(failure == null);
            bool closed = Closed(Pipe(endpoint), original);
            if (observation == "written-noninherited-verified") { child.StandardInput.WriteLine("release"); child.StandardInput.Flush(); }
            CallerNative.Require(child.WaitForExit(2000) && child.ExitCode == 0 && child.StandardError.ReadToEnd().Length == 0);
            Console.WriteLine("{\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"timedOut\":" + timedOut.ToString().ToLowerInvariant() +
                ",\"connectedBeforeExpiry\":" + connectedBeforeExpiry.ToString().ToLowerInvariant() + ",\"frameAfterExpiry\":" + frameAfterExpiry.ToString().ToLowerInvariant() +
                ",\"closed\":" + closed.ToString().ToLowerInvariant() + ",\"threadUnimpersonated\":" + clean.ToString().ToLowerInvariant() + "}");
        }
    }

    private static void Inspect(CallerEndpoint endpoint)
    {
        var pipe = Pipe(endpoint);
        uint handleFlags, flags, output, input, instances;
        if (!CallerEndpointNative.GetHandleInformation(pipe, out handleFlags) || (handleFlags & 1) != 0) throw new Exception("inspect-inheritance");
        if (!GetNamedPipeInfo(pipe, out flags, out output, out input, out instances) || (flags & 4) == 0 || instances != 1) throw new Exception("inspect-info:" + flags + ":" + instances);
        uint state;
        if (!CallerNative.GetNamedPipeHandleState(pipe, out state, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0) || (state & 3) != 3) throw new Exception("inspect-state:" + state);
        IntPtr owner, group, dacl, sacl, descriptor;
        uint securityError = GetSecurityInfo(pipe, 1, 4, out owner, out group, out dacl, out sacl, out descriptor);
        if (securityError != 0) throw new Exception("inspect-security-error:" + securityError);
        try
        {
            uint length = GetSecurityDescriptorLength(descriptor);
            CallerNative.Require(length > 0 && length <= 65536);
            byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            if ((security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || security.DiscretionaryAcl.Count != 1) throw new Exception("inspect-descriptor:" + security.GetSddlForm(AccessControlSections.All));
            var ace = (CommonAce)security.DiscretionaryAcl[0];
            string logon = IndependentLogonSid();
            if (logon == null || ace.SecurityIdentifier.Value != logon || ace.AccessMask != 0x001f01ff || ace.AceQualifier != AceQualifier.AccessAllowed)
                throw new Exception("inspect-ace:" + security.GetSddlForm(AccessControlSections.All) + ":" + logon);
            CallerNative.Require((CallerEndpointNative.ClientRights & 4) == 0);
        }
        finally { CallerEndpointNative.LocalFree(descriptor); }
    }

    private static void InspectSyntheticPeerMask()
    {
        const string inertSid = "S-1-5-21-111111111-222222222-333333333-4242";
        string name = "\\\\.\\pipe\\aegis-owned-caller-" + Guid.NewGuid().ToString("N");
        // Actual disposable descriptor application/inspection with an inert synthetic SID; no foreign logon is tested.
        using (var pipe = CallerEndpointNative.Create(name, IndependentLogonSid(), inertSid)) {
            IntPtr owner, group, dacl, sacl, descriptor;
            CallerNative.Require(GetSecurityInfo(pipe, 1, 4, out owner, out group, out dacl, out sacl, out descriptor) == 0);
            try {
                uint length = GetSecurityDescriptorLength(descriptor);
                CallerNative.Require(length > 0 && length <= 65536);
                byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
                var security = new RawSecurityDescriptor(bytes, 0);
                CallerNative.Require(security.DiscretionaryAcl.Count == 2);
                var peer = (CommonAce)security.DiscretionaryAcl[1];
                CallerNative.Require(peer.SecurityIdentifier.Value == inertSid && peer.AccessMask == 0x00100182 &&
                    (peer.AccessMask & 4) == 0 && peer.AceQualifier == AceQualifier.AccessAllowed);
            }
            finally { CallerEndpointNative.LocalFree(descriptor); }
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && (args[0] == "child" || args[0] == "silent-child" || args[0] == "scheduled-child")) return Child(args[0]);
        if (args.Length != 1) return 2;
        string mode = args[0];
        Process child = null, sibling = null;
        try
        {
            child = StartChild(mode.StartsWith("aggregate-", StringComparison.Ordinal) ? "scheduled-child" : mode == "connected-silent-deadline" ? "silent-child" : "child");
            using (var peer = new CallerRegistration(child.Handle, new string('b', 32)))
            using (var self = Process.GetCurrentProcess())
            using (var endpoint = new CallerEndpoint(peer, child.Handle))
            {
                IntPtr originalPipe = Pipe(endpoint).DangerousGetHandle();
                bool accepted = false, rejected = false, closed = false, connectedReady = false, silentPeerAlive = false;
                long elapsed = 0;
                if (mode == "buffered-expired" || mode == "auth-token-deadline" || mode == "auth-revert-deadline")
                { AuthenticationDeadline(mode, child, endpoint, peer, self.Handle); return 0; }
                if (mode == "aggregate-deadline" || mode == "aggregate-positive")
                { AggregateDeadline(child, endpoint, peer, self.Handle, mode == "aggregate-positive"); return 0; }
                if (mode == "connected-silent-deadline")
                {
                    Supply(child, endpoint, peer, self.Handle);
                    var ready = child.StandardOutput.ReadLineAsync();
                    CallerNative.Require(ready.Wait(3000) && ready.Result == "connected-noninherited-verified-no-frame");
                    uint clientPid, available, left;
                    CallerNative.Require(CallerNative.GetNamedPipeClientProcessId(Pipe(endpoint), out clientPid) && clientPid == child.Id &&
                        CallerNative.PeekNamedPipe(Pipe(endpoint), IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == 0 && left == 0);
                    connectedReady = true;
                    var timer = Stopwatch.StartNew();
                    try { var unexpected = endpoint.Accept(100); unexpected.CheckCurrent(); accepted = true; }
                    catch (InvalidOperationException) { rejected = true; }
                    catch (TimeoutException) { rejected = true; }
                    elapsed = timer.ElapsedMilliseconds;
                    closed = Closed(Pipe(endpoint), originalPipe); silentPeerAlive = !child.HasExited;
                    CallerNative.Require(!CallerNative.HasThreadToken());
                    child.StandardInput.WriteLine("close-without-frame"); child.StandardInput.Flush();
                    CallerNative.Require(child.WaitForExit(2000) && child.ExitCode == 0 && child.StandardError.ReadToEnd().Length == 0);
                }
                else if (mode == "descriptor") { Inspect(endpoint); rejected = true; }
                else if (mode == "synthetic-peer-mask") { InspectSyntheticPeerMask(); rejected = true; }
                else if (mode == "second-instance")
                {
                    string logon = IndependentLogonSid();
                    try { using (var second = CallerEndpointNative.Create(endpoint.LocalLocator, logon, logon)) { } }
                    catch (InvalidOperationException error) { CallerNative.Require(error.Message == "caller-endpoint-create-denied:231" || error.Message == "caller-endpoint-create-denied:5"); rejected = true; }
                }
                else if (mode == "squatting")
                {
                    string name = "\\\\.\\pipe\\aegis-owned-caller-" + Guid.NewGuid().ToString("N"), logon = IndependentLogonSid();
                    using (var existing = RawPipe(name, 1, 4 | 2 | 1 | 8, 1, 0, 8192, 2000, IntPtr.Zero)) {
                        CallerNative.Require(!existing.IsInvalid);
                        try { using (var second = CallerEndpointNative.Create(name, logon, logon)) { } }
                        catch (InvalidOperationException error) { CallerNative.Require(error.Message == "caller-endpoint-create-denied:231" || error.Message == "caller-endpoint-create-denied:5"); rejected = true; }
                    }
                }
                else if (mode == "deadline" || mode == "client-deadline" || mode == "remote-locator")
                {
                    var timer = Stopwatch.StartNew();
                    try
                    {
                        if (mode == "deadline") endpoint.Accept(100);
                        else using (var server = new CallerRegistration(self.Handle, new string('b', 32)))
                        using (var missing = CallerEndpoint.ConnectLocal(mode == "remote-locator" ? "\\\\foreign\\pipe\\x" :
                            "\\\\.\\pipe\\aegis-owned-caller-" + Guid.NewGuid().ToString("N"), server, 100)) { }
                    }
                    catch (TimeoutException) { rejected = true; }
                    catch (InvalidOperationException) { if (mode != "remote-locator") throw; rejected = true; }
                    elapsed = timer.ElapsedMilliseconds;
                    closed = mode != "deadline" || Closed(Pipe(endpoint), originalPipe);
                }
                else if (mode == "dispose")
                {
                    var held = Pipe(endpoint); endpoint.Dispose(); endpoint.Dispose();
                    closed = Closed(held, originalPipe);
                    try { endpoint.Accept(100); } catch (InvalidOperationException) { rejected = true; }
                }
                else
                {
                    Process actual = child;
                    if (mode == "sibling") { sibling = StartChild(); actual = sibling; }
                    Supply(actual, endpoint, peer, mode == "wrong-server" ? child.Handle : self.Handle);
                    string observation = actual.StandardOutput.ReadLine();
                    if (mode == "wrong-server") { CallerNative.Require(observation == "server-denied"); rejected = true; }
                    else
                    {
                        CallerNative.Require(observation == "written-noninherited-verified");
                        try
                        {
                            var context = endpoint.Accept(1000); context.CheckCurrent(); accepted = true;
                            if (mode == "close-context") {
                                endpoint.Dispose();
                                try { context.CheckCurrent(); } catch (InvalidOperationException) { rejected = true; }
                                closed = Closed(Pipe(endpoint), originalPipe);
                            }
                        }
                        catch (InvalidOperationException) { if (mode != "sibling") throw; rejected = true; closed = Closed(Pipe(endpoint), originalPipe); }
                        actual.StandardInput.WriteLine("release"); actual.StandardInput.Flush();
                    }
                    CallerNative.Require(actual.WaitForExit(2000) && actual.ExitCode == 0 && actual.StandardError.ReadToEnd().Length == 0);
                }
                Console.WriteLine("{\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"rejected\":" + rejected.ToString().ToLowerInvariant() +
                    ",\"closed\":" + closed.ToString().ToLowerInvariant() + ",\"elapsed\":" + elapsed + ",\"crossProcess\":" + (mode == "positive" || mode == "close-context" || mode == "connected-silent-deadline").ToString().ToLowerInvariant() +
                    ",\"connectedReady\":" + connectedReady.ToString().ToLowerInvariant() + ",\"silentPeerAlive\":" + silentPeerAlive.ToString().ToLowerInvariant() + "}");
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Stop(sibling); Stop(child); }
    }
}
