using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
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

    private static Process StartChild()
    {
        return Process.Start(new ProcessStartInfo {
            FileName = typeof(CallerEndpointFixture).Assembly.Location, Arguments = "child", UseShellExecute = false,
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

    private static int Child()
    {
        using (var imported = new SafeFileHandle(new IntPtr(long.Parse(Console.ReadLine())), true))
        {
            string locator = Console.ReadLine(), session = Console.ReadLine(), generation = Console.ReadLine();
            using (var server = new CallerRegistration(imported.DangerousGetHandle(), session))
            {
                try
                {
                    using (var client = CallerEndpoint.ConnectLocal(locator, server, 1000))
                    {
                        uint flags;
                        CallerNative.Require(CallerEndpointNative.GetHandleInformation(client, out flags) && (flags & 1) == 0);
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
        if (args.Length == 1 && args[0] == "child") return Child();
        if (args.Length != 1) return 2;
        string mode = args[0];
        Process child = null, sibling = null;
        try
        {
            child = StartChild();
            using (var peer = new CallerRegistration(child.Handle, new string('b', 32)))
            using (var self = Process.GetCurrentProcess())
            using (var endpoint = new CallerEndpoint(peer, child.Handle))
            {
                IntPtr originalPipe = Pipe(endpoint).DangerousGetHandle();
                bool accepted = false, rejected = false, closed = false;
                long elapsed = 0;
                if (mode == "descriptor") { Inspect(endpoint); rejected = true; }
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
                    ",\"closed\":" + closed.ToString().ToLowerInvariant() + ",\"elapsed\":" + elapsed + ",\"crossProcess\":" + (mode == "positive" || mode == "close-context").ToString().ToLowerInvariant() + "}");
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Stop(sibling); Stop(child); }
    }
}
