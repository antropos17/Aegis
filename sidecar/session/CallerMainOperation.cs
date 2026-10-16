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
        private InstalledFixedOperationRegistration fixedRegistration;
        private CallerEndpoint endpoint;
        private CallerAdmission.Context admission;
        private Context publishedContext;
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
#if CALLER_MAIN_OPERATION_TEST
        internal static CallerMainOperation AcquireInstalledForTest(EnrollmentLease lease, CallerRegistration server,
            IntPtr heldMain, IEnrollmentFiles files, InstalledOwnerRegistration installed)
        {
            CallerNative.Require(installed != null);
            return AcquireCore(lease, server, heldMain, files, installed);
        }
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
                    if (installed != null)
                    {
                        var registeredOwner = installed as InstalledOwnerRegistration;
                        CallerNative.Require(registeredOwner != null);
                        owner.fixedRegistration = InstalledFixedOperationRegistration.Acquire(owner.proof, registeredOwner, files);
                    }
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
                    admission = admitted; publishedContext = new Context(this); published = true; return publishedContext;
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
            substage = 11; proof.CheckCurrent();
            if (fixedRegistration != null) fixedRegistration.CheckCurrent();
            endpoint.CheckCurrent(ref substage);
            substage = 12; CallerNative.Require(!CallerNative.HasThreadToken());
        }
        internal sealed class Context
        {
            private readonly CallerMainOperation owner;
            private readonly CallerAdmission.Context native;
            private bool inspected;
            private InspectionCompletion completion;
            private InstalledOwnerDeadline inspectionDeadline;
            private InstalledInspectionAuthorization authorization;
            internal Context(CallerMainOperation operation)
            { owner = operation; native = operation.admission; }
            internal void CheckCurrent()
            {
                lock (owner.server.Gate)
                {
                    try { CheckBinding(); owner.CheckCore(); native.CheckCurrent(); owner.proof.CheckSelection(native); }
                    catch { owner.Close(); throw; }
                }
            }
            internal void CheckInstalledOwner(InstalledOwnerRegistration expected)
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CheckCurrent(); CheckInstalledBinding(expected);
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
                        CallerNative.Require(owner.fixedRegistration == null);
                        return InspectCore();
                    }
                    catch { owner.Close(); throw; }
                }
            }
            internal InspectionCompletion InspectInstalledOwned(InstalledOwnerRegistration installed, InstalledOwnerDeadline deadline)
            {
                InstalledInspectionAuthorization issued = IssueInspectionAuthorization(installed, deadline);
                return DispatchInstalledInspection(issued, InstalledFixedOperationRegistration.Operation, installed, deadline);
            }
            private string InspectCore()
            {
                CallerNative.Require(!inspected); CheckCurrent(); inspected = true;
                string result = owner.proof.Inspect(native); CheckCurrent(); return result;
            }
            private InstalledInspectionAuthorization IssueInspectionAuthorization(InstalledOwnerRegistration installed, InstalledOwnerDeadline deadline)
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CallerNative.Require(deadline != null && completion == null && inspectionDeadline == null && authorization == null &&
                            owner.fixedRegistration != null && !inspected);
                        inspectionDeadline = deadline;
                        CheckInstalledOwner(installed); deadline.Check();
                        authorization = new InstalledInspectionAuthorization(this, native, owner.main.Generation, owner.fixedRegistration, installed, deadline);
                        return authorization;
                    }
                    catch { owner.Close(); throw; }
                }
            }
            private InspectionCompletion DispatchInstalledInspection(InstalledInspectionAuthorization issued, string operation,
                InstalledOwnerRegistration installed, InstalledOwnerDeadline deadline)
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CallerNative.Require(authorization != null && Object.ReferenceEquals(authorization, issued) &&
                            Object.ReferenceEquals(inspectionDeadline, deadline) && completion == null);
                        CheckInstalledOwner(installed); deadline.Check();
                        authorization.Consume(this, native, owner.main.Generation, owner.fixedRegistration, installed, deadline, operation);
                        string result = InspectCore();
                        completion = new InspectionCompletion(this, installed, deadline, native, result);
                        completion.CheckCurrent(); return completion;
                    }
                    catch { owner.Close(); throw; }
                }
            }
#if CALLER_MAIN_OPERATION_TEST
            // These seams issue and consume the real native authorization after genuine pipe admission.
            internal InstalledInspectionAuthorization IssueInspectionAuthorizationForTest(InstalledOwnerRegistration installed, InstalledOwnerDeadline deadline)
            { return IssueInspectionAuthorization(installed, deadline); }
            internal InspectionCompletion DispatchInstalledInspectionForTest(InstalledInspectionAuthorization issued, string operation,
                InstalledOwnerRegistration installed, InstalledOwnerDeadline deadline)
            { return DispatchInstalledInspection(issued, operation, installed, deadline); }
#endif
            private void CheckBinding()
            {
                CallerNative.Require(owner.published && Object.ReferenceEquals(owner.publishedContext, this) &&
                    Object.ReferenceEquals(owner.admission, native));
            }
            private void CheckInstalledBinding(InstalledOwnerRegistration installed)
            {
                CallerNative.Require(installed != null && Object.ReferenceEquals(owner.installed, installed));
                installed.CheckCurrent();
                CallerNative.Require(native.SelectionId == installed.Policy.SelectionId &&
                    native.SelectionEpoch == installed.Policy.SelectionEpoch && native.InventoryRevision == installed.Policy.Revision);
                owner.fixedRegistration.CheckOwner(installed);
            }
            internal void CheckCompleted(InspectionCompletion issued, InstalledOwnerRegistration installed,
                InstalledOwnerDeadline deadline, CallerAdmission.Context original)
            {
                lock (owner.server.Gate)
                {
                    try
                    {
                        CallerNative.Require(deadline != null && Object.ReferenceEquals(inspectionDeadline, deadline) &&
                            inspected && completion != null && issued != null && Object.ReferenceEquals(completion, issued) &&
                            Object.ReferenceEquals(native, original));
                        deadline.Check(); CheckBinding(); owner.CheckCore(); native.CheckRetained();
                        owner.proof.CheckSelection(native); CheckInstalledBinding(installed);
                        CallerNative.Require(authorization != null);
                        authorization.CheckRetained(this, native, owner.main.Generation, owner.fixedRegistration, installed, deadline);
                        deadline.Check();
                    }
                    catch { owner.Close(); throw; }
                }
            }
        }
        // Terminal read-only result fence. It exposes no dispatch or renewal,
        // and retains the original supervisor deadline and exact caller/owner.
        internal sealed class InspectionCompletion
        {
            private readonly Context caller;
            private readonly InstalledOwnerRegistration installed;
            private readonly InstalledOwnerDeadline deadline;
            private readonly CallerAdmission.Context admission;
            internal readonly string Result;
            internal InspectionCompletion(Context original, InstalledOwnerRegistration owner, InstalledOwnerDeadline limit,
                CallerAdmission.Context admitted, string result)
            { caller = original; installed = owner; deadline = limit; admission = admitted; Result = result; }
            internal void CheckCurrent() { caller.CheckCompleted(this, installed, deadline, admission); }
            internal void CheckInstalledOwner(InstalledOwnerRegistration expected)
            { caller.CheckCompleted(this, expected, deadline, admission); }
        }
        private void CloseResource(IDisposable resource)
        { if (resource != null) try { resource.Dispose(); } catch { cleanupUnknown = true; } }
        private void Close()
        {
            if (!closed)
            {
                closed = true; CloseResource(endpoint); CloseResource(fixedRegistration); CloseResource(proof); CloseResource(main);
            }
            if (cleanupUnknown) throw new InvalidDataException("main-operation-cleanup-unconfirmed");
        }
        public void Dispose() { lock (server.Gate) Close(); }
    }
}
