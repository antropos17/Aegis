using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Construct only from a trusted launcher's retained process handle, never JSON.
    internal sealed partial class CallerRegistration : IDisposable
    {
        internal readonly object Gate;
        private readonly CallerRegistration authorityServer;
        private readonly SafeFileHandle process, token;
        private readonly uint pid;
        private readonly long birth;
        private readonly CallerIdentity identity;
        internal readonly string Generation, Session;
        private bool revoked;

        internal CallerRegistration(IntPtr heldProcess, string session)
            : this(heldProcess, session, 0, 0) { }

        // Optional observed metadata validates the imported native reference; it never opens a process.
        internal CallerRegistration(IntPtr heldProcess, string session, uint expectedPid, long expectedBirth)
            : this(heldProcess, session, expectedPid, expectedBirth, null) { }

        private CallerRegistration(IntPtr heldProcess, string session, uint expectedPid, long expectedBirth,
            CallerRegistration server)
        {
            authorityServer = server; Gate = server == null ? new object() : server.Gate;
            CallerNative.Require(System.Text.RegularExpressions.Regex.IsMatch(session ?? "", "\\A[a-f0-9]{32}\\z"));
            process = CallerNative.Duplicate(heldProcess);
            try
            {
                pid = CallerNative.GetProcessId(process);
                long exit, kernel, user;
                CallerNative.Require(pid != 0 && CallerNative.GetProcessTimes(process, out birth, out exit, out kernel, out user));
                CallerNative.Require((expectedPid == 0 && expectedBirth == 0) || (expectedPid == pid && expectedBirth == birth));
                token = CallerNative.ProcessToken(process);
                identity = CallerIdentity.Observe(token);
                CallerNative.Require(identity.PermittedBroker());
                Session = session;
                Generation = Guid.NewGuid().ToString("N");
                CheckLive(pid);
            }
            catch { if (token != null) token.Dispose(); process.Dispose(); throw; }
        }

        // Trusted native construction only. Retain the exact server object as well as its gate.
        internal static CallerRegistration RegisterMain(IntPtr heldProcess, CallerRegistration server)
        {
            CallerNative.Require(server != null && server.authorityServer == null);
            lock (server.Gate)
            {
                server.CheckCurrent();
                // Routing label belongs to this server group; every registration still gets its own fresh Generation.
                var main = new CallerRegistration(heldProcess, server.Session, 0, 0, server);
                try { server.CheckCurrent(); return main; }
                catch { main.Dispose(); throw; }
            }
        }
        internal void CheckMain(CallerRegistration server, CallerRegistration broker = null)
        {
            // Refuse mismatched pairs before taking any additional gate.
            CallerNative.Require(server != null && ReferenceEquals(authorityServer, server) && ReferenceEquals(Gate, server.Gate));
            CheckCurrent();
            if (broker != null) CallerNative.Require(identity.SameOperator(broker.identity));
        }
        internal void CheckServer() { CallerNative.Require(authorityServer == null); CheckCurrent(); }
        internal void CheckHeldProcess(SafeFileHandle held)
        {
            CheckCurrent();
            long observedBirth, exit, kernel, user;
            CallerNative.Require(held != null && !held.IsClosed && !held.IsInvalid &&
                CallerNative.GetProcessId(held) == pid && CallerNative.GetProcessTimes(held,
                    out observedBirth, out exit, out kernel, out user) && observedBirth == birth &&
                CallerNative.WaitForSingleObject(held, 0) == 0x102);
        }

        internal void CheckLive(uint observedPid)
        {
            CallerNative.Require(!revoked && !process.IsClosed && observedPid == pid &&
                CallerNative.WaitForSingleObject(process, 0) == 0x102);
            long observedBirth, exit, kernel, user;
            CallerNative.Require(CallerNative.GetProcessTimes(process, out observedBirth, out exit, out kernel, out user) &&
                observedBirth == birth && birth > 0 && CallerNative.GetProcessId(process) == pid);
            // Re-query the current process token too: replacing a primary token
            // or changing its attributes cannot preserve the original registration.
            using (SafeFileHandle current = CallerNative.ProcessToken(process))
                CallerNative.Require(identity.SamePrimaryToken(CallerIdentity.Observe(current)));
        }

        internal void CheckCaller(uint observedPid, CallerIdentity caller)
        {
            CheckLive(observedPid);
            CallerNative.Require(identity.MatchesImpersonation(caller));
        }

        internal void VerifyServer(SafeHandle pipe)
        {
            lock (Gate)
            {
                uint observed;
                CallerNative.Require(CallerNative.GetNamedPipeServerProcessId(pipe, out observed));
                CheckLive(observed);
            }
        }

        internal void CheckCurrent() { CheckLive(pid); }

        public void Dispose()
        {
            lock (Gate)
            {
                revoked = true;
                if (token != null) token.Dispose();
                process.Dispose();
            }
        }
    }
}
