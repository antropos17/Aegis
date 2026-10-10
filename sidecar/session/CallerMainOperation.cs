using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Opt-in retained role admission and the single fixed read-only inspection.
    internal sealed class CallerMainOperation : IDisposable
    {
        private readonly CallerRegistration server;
        private CallerRegistration main;
        private MainRegistrationEvidence proof;
        private CallerEndpoint endpoint;
        private CallerAdmission.Context admission;
        private bool published, closed, cleanupUnknown;
        internal sealed class Routing
        {
            internal readonly string Locator, Session, Generation;
            internal Routing(CallerEndpoint endpoint, CallerRegistration main)
            { Locator = endpoint.LocalLocator; Session = main.Session; Generation = main.Generation; }
        }
        internal Routing Labels { get; private set; }
        private CallerMainOperation(CallerRegistration exactServer) { server = exactServer; }
        internal static CallerMainOperation Acquire(EnrollmentLease lease, CallerRegistration server, IntPtr heldMain)
        { return AcquireCore(lease, server, heldMain, new EnrollmentNative()); }
#if ENROLLMENT_LEASE_TEST
        internal static CallerMainOperation AcquireForTest(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, IEnrollmentFiles files)
        { return AcquireCore(lease, server, heldMain, files); }
#endif
        private static CallerMainOperation AcquireCore(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, IEnrollmentFiles files)
        {
            CallerNative.Require(lease != null && server != null && files != null);
            lease.CheckServerAssociation(server);
            lock (server.Gate)
            {
                var owner = new CallerMainOperation(server);
                try
                {
                    // The pipe must be hosted by this exact held enrolled server instance.
                    using (var self = Process.GetCurrentProcess())
                    using (var heldSelf = CallerNative.Duplicate(self.Handle)) server.CheckHeldProcess(heldSelf);
                    lease.BindServer(server);
                    owner.main = CallerRegistration.RegisterMain(heldMain, server);
                    owner.proof = MainRegistrationEvidence.Acquire(lease, server, owner.main, files);
                    owner.endpoint = new CallerEndpoint(owner.main, heldMain);
                    owner.CheckCore(); owner.Labels = new Routing(owner.endpoint, owner.main);
                    return owner;
                }
                catch { owner.Close(); throw; }
            }
        }
        internal Context Accept(int timeoutMilliseconds)
        {
            lock (server.Gate)
            {
                try
                {
                    CallerNative.Require(!published); CheckCore();
                    CallerAdmission.Context admitted = endpoint.AcceptMain(timeoutMilliseconds);
                    // Authenticate has reverted before proof/selection rechecks and publication.
                    CheckCore(); admitted.CheckCurrent(); proof.CheckSelection(admitted); CheckCore();
                    admission = admitted; var context = new Context(this); published = true; return context;
                }
                catch { Close(); throw; }
            }
        }
        private void CheckCore()
        {
            CallerNative.Require(!closed && !CallerNative.HasThreadToken());
            server.CheckServer(); proof.CheckCurrent(); endpoint.CheckCurrent();
            CallerNative.Require(!CallerNative.HasThreadToken());
        }
        internal sealed class Context
        {
            private readonly CallerMainOperation owner;
            private readonly CallerAdmission.Context native;
            internal Context(CallerMainOperation operation)
            { owner = operation; native = operation.admission; }
            internal void CheckCurrent()
            {
                lock (owner.server.Gate)
                {
                    try { CallerNative.Require(owner.published); owner.CheckCore(); native.CheckCurrent(); owner.proof.CheckSelection(native); }
                    catch { owner.Close(); throw; }
                }
            }
            internal string InspectOwned()
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CheckCurrent(); string result = owner.proof.Inspect(native); CheckCurrent(); return result;
                    }
                    catch { owner.Close(); throw; }
                }
            }
        }
        private void CloseResource(IDisposable resource)
        { if (resource != null) try { resource.Dispose(); } catch { cleanupUnknown = true; } }
        private void Close()
        {
            if (!closed)
            {
                closed = true; CloseResource(endpoint); CloseResource(proof); CloseResource(main);
            }
            if (cleanupUnknown) throw new InvalidDataException("main-operation-cleanup-unconfirmed");
        }
        public void Dispose() { lock (server.Gate) Close(); }
    }
}
