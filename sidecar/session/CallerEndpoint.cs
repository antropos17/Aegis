using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Only a retained installed guard supplies this authority; no received flag or SID does.
    internal interface ICallerInstalledEndpoint
    {
        void CheckEndpoint(SafeFileHandle self, SafeFileHandle peer);
        void CheckCurrent();
        void CheckCurrent(ref int substage, bool polling);
        void CheckCurrent(CallerAdmissionBudget budget, ref int substage, bool polling);
    }
    // Internal owned endpoint primitive. Installation and trusted locator/registration delivery remain separate gates.
    internal sealed class CallerEndpoint : IDisposable
    {
        private readonly object gate = new object();
        private readonly CallerRegistration peer;
        private readonly SafeFileHandle pipe;
        private readonly ICallerInstalledEndpoint installed;
        private bool consumed, disposed;
        internal readonly string LocalLocator;

        internal CallerEndpoint(CallerRegistration registration, IntPtr heldPeerProcess)
            : this(registration, heldPeerProcess, null) { }
        internal CallerEndpoint(CallerRegistration registration, IntPtr heldPeerProcess, ICallerInstalledEndpoint authority)
        {
            peer = registration; installed = authority;
            CallerNative.Require(!CallerNative.HasThreadToken());
            using (var held = CallerNative.Duplicate(heldPeerProcess))
            using (var token = CallerNative.ProcessToken(held))
            using (var current = Process.GetCurrentProcess())
            using (var selfProcess = CallerNative.Duplicate(current.Handle))
            using (var self = CallerNative.ProcessToken(selfProcess))
            {
                lock (peer.Gate)
                {
                    peer.CheckLive(CallerNative.GetProcessId(held));
                    CallerNative.Require(CallerIdentity.Observe(self).PermittedBroker());
                    LocalLocator = "\\\\.\\pipe\\aegis-owned-caller-" + Guid.NewGuid().ToString("N");
                    // LocalSystem has no logon SID. Only the retained installed guard authorizes its fixed SID.
                    if (installed != null) installed.CheckEndpoint(selfProcess, held);
                    string serverPrincipal = installed == null ? CallerEndpointNative.LogonSid(self) : "S-1-5-18";
#if CALLER_MAIN_OPERATION_TEST
                    // Synthetic installed descriptors use the observed fixture logon; production retains SYSTEM.
                    var testOwner = installed as InstalledOwnerRegistration;
                    if (testOwner != null && testOwner.IsTestAuthority) serverPrincipal = CallerEndpointNative.LogonSid(self);
#endif
                    pipe = CallerEndpointNative.Create(LocalLocator, serverPrincipal, CallerEndpointNative.LogonSid(token));
                }
            }
        }

        internal CallerAdmission.Context Accept(int timeoutMilliseconds)
        { return Accept(new CallerAdmissionBudget(timeoutMilliseconds)); }
        internal CallerAdmission.Context Accept(CallerAdmissionBudget budget)
        { int substage = 0; return AcceptCore(budget, false, ref substage); }
        internal CallerAdmission.Context AcceptMain(int timeoutMilliseconds)
        { int substage = 0; return AcceptMain(timeoutMilliseconds, ref substage); }
        internal CallerAdmission.Context AcceptMain(int timeoutMilliseconds, ref int substage)
        { substage = 19; return AcceptMain(new CallerAdmissionBudget(timeoutMilliseconds), ref substage); }
        internal CallerAdmission.Context AcceptMain(CallerAdmissionBudget budget, ref int substage)
        { return AcceptCore(budget, true, ref substage); }
        private CallerAdmission.Context AcceptCore(CallerAdmissionBudget budget, bool main, ref int substage)
        {
            substage = 19; CallerNative.Require(budget != null);
            // A contender owns no attempt until this acquisition succeeds.
            using (budget.Enter(gate))
            {
                substage = 22; CallerNative.Require(!disposed && !consumed);
                consumed = true;
                try
                {
                    while (true)
                    {
                        budget.Check();
                        using (budget.Enter(peer.Gate))
                        {
                            substage = 17; peer.CheckCurrent();
                            budget.Check(); substage = 18; if (installed != null) installed.CheckCurrent(budget, ref substage, true);
                        }
                        budget.Check();
                        substage = 2;
                        bool result = CallerEndpointNative.ConnectNamedPipe(pipe, IntPtr.Zero);
                        int error = result ? 0 : Marshal.GetLastWin32Error();
                        budget.Check();
                        // In NOWAIT mode TRUE means listening, not connected. Only 535 admits the connection.
                        if (!result && error == 535) break;
                        CallerNative.Require(result || error == 536);
                        substage = 3; budget.Pause();
                    }
                    // Keep NOWAIT: no pending native IO, and the existing admission reads one already-peeked message.
                    CallerAdmission.Context context = main ? CallerAdmission.ReadMainAndAuthenticate(pipe, peer, new CallerNative(), budget, ref substage) :
                        CallerAdmission.ReadAndAuthenticate(pipe, peer, new CallerNative(), budget);
                    budget.Check(); return context;
                }
                catch { Close(); throw; }
            }
        }

        // A composition fence, without consuming a connection or supplying authority.
        internal void CheckCurrent()
        { int substage = 0; CheckCurrent(ref substage); }
        internal void CheckCurrent(ref int substage)
        { CheckCurrent(null, ref substage); }
        internal void CheckCurrent(CallerAdmissionBudget budget, ref int substage)
        {
            using (CallerAdmissionBudget.Enter(gate, budget))
            using (CallerAdmissionBudget.Enter(peer.Gate, budget))
            {
                substage = 13; CallerNative.Require(!CallerNative.HasThreadToken() && !disposed &&
                    !pipe.IsClosed && !pipe.IsInvalid);
                substage = 14; CallerEndpointNative.RequireNonInherited(pipe);
                substage = 15; peer.CheckCurrent();
                CallerAdmissionBudget.Check(budget);
                substage = 16; if (installed != null) {
                    if (budget == null) installed.CheckCurrent(ref substage, false); else installed.CheckCurrent(budget, ref substage, false);
                }
                substage = 12; CallerNative.Require(!CallerNative.HasThreadToken());
                CallerAdmissionBudget.Check(budget);
            }
        }

        internal static SafeFileHandle ConnectLocal(string locator, CallerRegistration expectedServer, int timeoutMilliseconds)
        {
            var budget = new CallerAdmissionBudget(timeoutMilliseconds);
            CallerNative.Require(locator != null && locator.Length == "\\\\.\\pipe\\aegis-owned-caller-".Length + 32 && Regex.IsMatch(locator,
                "\\A\\\\\\\\\\.\\\\pipe\\\\aegis-owned-caller-[a-f0-9]{32}\\z", RegexOptions.CultureInvariant));
            while (true)
            {
                budget.Check();
                using (budget.Enter(expectedServer.Gate)) { expectedServer.CheckCurrent(); budget.Check(); }
                var client = CallerEndpointNative.CreateFile(locator, CallerEndpointNative.ClientRights,
                    0, IntPtr.Zero, 3, 0x00100000 | 0x00020000, IntPtr.Zero);
                if (!client.IsInvalid)
                {
                    try
                    {
                        CallerEndpointNative.RequireNonInherited(client);
                        using (budget.Enter(expectedServer.Gate)) { expectedServer.VerifyServer(client); budget.Check(); }
                        uint mode = 1; // nonblocking writes; byte read mode unused by the one-way protocol
                        CallerNative.Require(CallerEndpointNative.SetNamedPipeHandleState(client, ref mode, IntPtr.Zero, IntPtr.Zero));
                        budget.Check(); return client;
                    }
                    catch { client.Dispose(); throw; }
                }
                int error = Marshal.GetLastWin32Error(); client.Dispose();
                CallerNative.Require(error == 2 || error == 231);
                budget.Pause();
            }
        }

        private void Close()
        {
            if (disposed) return;
            disposed = true;
            // No flush, reconnection or asynchronous operation; close invalidates every returned context.
            CallerEndpointNative.DisconnectNamedPipe(pipe);
            pipe.Dispose();
        }
        public void Dispose() { lock (gate) Close(); }
    }
}
