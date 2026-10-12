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
        private ICallerInstalledEndpoint installed;
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
        internal static CallerMainOperation AcquireInstalled(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, ICallerInstalledEndpoint installed)
        {
            CallerNative.Require(installed != null);
            return AcquireCore(lease, server, heldMain, new EnrollmentNative(), installed);
        }
#if ENROLLMENT_LEASE_TEST
        internal static CallerMainOperation AcquireForTest(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, IEnrollmentFiles files)
        { return AcquireCore(lease, server, heldMain, files); }
#endif
        private static CallerMainOperation AcquireCore(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, IEnrollmentFiles files, ICallerInstalledEndpoint installed = null)
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
                    owner.installed = installed;
                    owner.endpoint = new CallerEndpoint(owner.main, heldMain, installed);
                    owner.CheckCore(); owner.Labels = new Routing(owner.endpoint, owner.main);
                    return owner;
                }
                catch { owner.Close(); throw; }
            }
        }
        internal Context Accept(int timeoutMilliseconds)
        { int substage = 0; return Accept(timeoutMilliseconds, ref substage); }
        // Fixed installed stage-seven last checkpoints; no native data is serialized.
        // Post-admission checks retain checkpoint 6 and their existing default sink.
        internal Context Accept(int timeoutMilliseconds, ref int substage)
        {
            lock (server.Gate)
            {
                try
                {
                    substage = 8; CallerNative.Require(!published); CheckCore(ref substage);
                    CallerAdmission.Context admitted = endpoint.AcceptMain(timeoutMilliseconds, ref substage);
                    // Authenticate has reverted before proof/selection rechecks and publication.
                    substage = 6; CheckCore(); admitted.CheckCurrent(); proof.CheckSelection(admitted); CheckCore();
                    admission = admitted; var context = new Context(this); published = true; return context;
                }
                catch { Close(); throw; }
            }
        }
        private void CheckCore()
        { int substage = 0; CheckCore(ref substage); }
        private void CheckCore(ref int substage)
        {
            substage = 9; CallerNative.Require(!closed && !CallerNative.HasThreadToken());
            substage = 10; server.CheckServer();
            substage = 11; proof.CheckCurrent(); endpoint.CheckCurrent(ref substage);
            substage = 12; CallerNative.Require(!CallerNative.HasThreadToken());
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
            internal void CheckInstalledOwner(InstalledOwnerRegistration expected)
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CallerNative.Require(expected != null && Object.ReferenceEquals(owner.installed, expected));
                        CheckCurrent();
                    }
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
