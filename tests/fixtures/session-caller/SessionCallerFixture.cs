using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class SessionCallerFixture
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint openMode, uint pipeMode,
        uint instances, uint output, uint input, uint timeout, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteFile(SafeFileHandle pipe, byte[] bytes, uint length, out uint written, IntPtr overlapped);

    private sealed class FailureNative : CallerNative
    {
        private readonly string mode;
        internal bool ImpersonationAttempted, TokenQueried, ReversionAttempted, FatalObserved;
        internal FailureNative(string selected) { mode = selected; }
        internal override bool Impersonate(SafeHandle pipe)
        { ImpersonationAttempted = true; return mode != "impersonation-failure" && base.Impersonate(pipe); }
        internal override SafeFileHandle ThreadToken()
        {
            TokenQueried = true;
            if (mode == "query-failure") throw new InvalidOperationException();
            return base.ThreadToken();
        }
        internal override bool Revert()
        {
            ReversionAttempted = true;
            // Really revert the fixture thread even when injecting a false API result.
            bool reverted = base.Revert();
            return mode != "revert-failure" && reverted;
        }
        internal override void RevertFailure() { FatalObserved = true; throw new InvalidOperationException("fixture-revert-failure"); }
    }

    private static Process StartChild()
    {
        return Process.Start(new ProcessStartInfo {
            FileName = typeof(SessionCallerFixture).Assembly.Location, Arguments = "client",
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        });
    }

    private static byte[] Frame(string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        byte[] frame = new byte[body.Length + 4];
        Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, frame, 0, 4);
        Buffer.BlockCopy(body, 0, frame, 4, body.Length);
        return frame;
    }

    private static void Supply(Process child, string pipe, CallerRegistration registration, string mode)
    {
        child.StandardInput.WriteLine(pipe);
        child.StandardInput.WriteLine(registration.Generation);
        child.StandardInput.WriteLine(registration.Session);
        child.StandardInput.WriteLine(mode);
        child.StandardInput.Flush();
    }

    private static void CloseChild(Process child)
    {
        if (child == null) return;
        try { if (!child.HasExited) child.Kill(); child.WaitForExit(3000); }
        finally { child.Dispose(); }
    }

    private static int Client()
    {
        string name = Console.ReadLine(), generation = Console.ReadLine(), session = Console.ReadLine(), mode = Console.ReadLine();
        using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut,
            PipeOptions.None, System.Security.Principal.TokenImpersonationLevel.Impersonation))
        {
            pipe.Connect(3000);
            string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"operation\":\"inspect-owned\"," +
                "\"requestId\":\"" + new string('a', 32) + "\",\"sessionId\":\"" + session +
                "\",\"generation\":\"" + generation + "\",\"sequence\":1}";
            if (mode == "malformed") json = "{}";
            if (mode == "oversize") json = new string('x', 4097);
            if (mode == "wrong-generation") json = json.Replace(generation, new string('f', 32));
            if (mode == "forged-pid") json = json.Replace("\"sequence\":1", "\"sequence\":1,\"pid\":" + Process.GetCurrentProcess().Id);
            byte[] frame = Frame(json);
            if (mode == "partial") frame = new byte[] { 1, 0 };
            if (mode == "invalid-utf8") frame = new byte[] { 2, 0, 0, 0, 0xc0, 0xaf };
            if (mode == "extra-frame") {
                byte[] twice = new byte[frame.Length * 2];
                Buffer.BlockCopy(frame, 0, twice, 0, frame.Length);
                Buffer.BlockCopy(frame, 0, twice, frame.Length, frame.Length);
                frame = twice;
            }
            pipe.Write(frame, 0, frame.Length);
            pipe.Flush();
            return pipe.ReadByte() == 1 ? 0 : 3;
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "client") { try { return Client(); } catch { return 4; } }
        if (args.Length != 1) return 2;
        string mode = args[0];
        Process registeredChild = null, sibling = null;
        CallerRegistration registration = null;
        try
        {
            string name = "aegis-caller-fixture-" + Guid.NewGuid().ToString("N");
            using (SafeFileHandle pipe = CreateNamedPipe("\\\\.\\pipe\\" + name,
                3 | 0x00080000, 4 | 2 | 8, 1, 8192, 8192, 2000, IntPtr.Zero))
            {
                CallerNative.Require(!pipe.IsInvalid);
                registeredChild = StartChild();
                registration = new CallerRegistration(registeredChild.Handle, new string('b', 32));
                if (mode == "server-positive" || mode == "server-mismatch")
                {
                    using (var self = Process.GetCurrentProcess())
                    using (var serverRegistration = new CallerRegistration(self.Handle, new string('b', 32)))
                    {
                        bool accepted = false;
                        Task peer = Task.Factory.StartNew(() => {
                            using (var client = new NamedPipeClientStream(".", name, PipeDirection.InOut)) {
                                client.Connect(3000);
                                try { (mode == "server-positive" ? serverRegistration : registration).VerifyServer(client.SafePipeHandle);
                                    accepted = true;
                                } catch (InvalidOperationException) { }
                            }
                        });
                        CallerNative.Require(ConnectNamedPipe(pipe, IntPtr.Zero) || Marshal.GetLastWin32Error() == 535);
                        CallerNative.Require(peer.Wait(4000));
                        Console.WriteLine("{\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"reverted\":true,\"contextRevoked\":false}");
                        return 0;
                    }
                }
                Process clientChild = registeredChild;
                if (mode == "sibling" || mode == "exited") {
                    if (mode == "exited") { registeredChild.Kill(); CallerNative.Require(registeredChild.WaitForExit(3000)); }
                    sibling = StartChild(); clientChild = sibling;
                }
                if (mode == "disposed") registration.Dispose();
                Supply(clientChild, name, registration, mode);
                CallerNative.Require(ConnectNamedPipe(pipe, IntPtr.Zero) || Marshal.GetLastWin32Error() == 535);
                bool admitted = false, contextRevoked = false;
                var observations = new FailureNative(mode);
                try
                {
                    var context = CallerAdmission.ReadAndAuthenticate(pipe, registration, observations);
                    context.CheckCurrent();
                    admitted = true;
                    if (mode == "revoke-context") {
                        registration.Dispose();
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                    if (mode == "disconnect-context") {
                        clientChild.Kill(); CallerNative.Require(clientChild.WaitForExit(3000));
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                    if (mode == "expired-context") {
                        System.Threading.Thread.Sleep(2100);
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                }
                catch (Exception error) {
                    if (!(error is InvalidOperationException) && !(error is InvalidDataException) && !(error is DecoderFallbackException)) throw;
                }
                uint written;
                WriteFile(pipe, new byte[] { admitted ? (byte)1 : (byte)0 }, 1, out written, IntPtr.Zero);
                CallerNative.Require(clientChild.WaitForExit(3000));
                CallerNative.Require(mode == "disconnect-context" || clientChild.ExitCode == (admitted ? 0 : 3));
                Console.WriteLine("{\"accepted\":" + admitted.ToString().ToLowerInvariant() +
                    ",\"reverted\":" + (!CallerNative.HasThreadToken()).ToString().ToLowerInvariant() +
                    ",\"contextRevoked\":" + contextRevoked.ToString().ToLowerInvariant() +
                    ",\"impersonationAttempted\":" + observations.ImpersonationAttempted.ToString().ToLowerInvariant() +
                    ",\"tokenQueried\":" + observations.TokenQueried.ToString().ToLowerInvariant() +
                    ",\"reversionAttempted\":" + observations.ReversionAttempted.ToString().ToLowerInvariant() +
                    ",\"fatalReversionObserved\":" + observations.FatalObserved.ToString().ToLowerInvariant() + "}");
                return 0;
            }
        }
        catch { return 2; }
        finally { if (registration != null) registration.Dispose(); CloseChild(sibling); CloseChild(registeredChild); }
    }
}
