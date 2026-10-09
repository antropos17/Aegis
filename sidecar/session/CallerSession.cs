using System;
using System.IO;

namespace Aegis.ProtectedSession
{
    // Keep optional composition dependencies out of the existing standalone launcher unit.
    internal static partial class CallerLauncher
    {
        internal sealed partial class Instance
        {
            // The lease duplicates the private held Job/process; neither raw handle escapes.
            internal EnrollmentLease AcquireEnrollment(string root)
            { return AcquireEnrollmentCore(root, null); }
#if ENROLLMENT_LEASE_TEST
            internal EnrollmentLease AcquireEnrollmentForTest(string root, IEnrollmentFiles files)
            { CallerNative.Require(files != null); return AcquireEnrollmentCore(root, files); }
#endif
            private EnrollmentLease AcquireEnrollmentCore(string root, IEnrollmentFiles files)
            {
                lock (gate)
                lock (Registration.Gate)
                {
                    CallerNative.Require(!releaseAttempted);
                    CheckCurrentLocked();
                    EnrollmentLease lease = null;
                    try
                    {
#if ENROLLMENT_LEASE_TEST
                        lease = files == null
                            ? EnrollmentLease.Acquire(root, created.Process.DangerousGetHandle(), created.Job.DangerousGetHandle())
                            : EnrollmentLease.AcquireForTest(root, created.Process.DangerousGetHandle(),
                                created.Job.DangerousGetHandle(), files);
#else
                        CallerNative.Require(files == null);
                        lease = EnrollmentLease.Acquire(root, created.Process.DangerousGetHandle(), created.Job.DangerousGetHandle());
#endif
                        CheckCurrentLocked(); return lease;
                    }
                    catch { if (lease != null) lease.Dispose(); throw; }
                }
            }
            internal CallerEndpoint CreateEndpoint()
            {
                lock (gate)
                lock (Registration.Gate)
                {
                    CallerNative.Require(!releaseAttempted);
                    CheckCurrentLocked();
                    var endpoint = new CallerEndpoint(Registration, created.Process.DangerousGetHandle());
                    try { CheckCurrentLocked(); return endpoint; }
                    catch { endpoint.Dispose(); throw; }
                }
            }
        }
    }

    // Shared by optional native setup, without a dependency on its implementation unit.
    internal interface ICallerSetup : IDisposable
    {
        void Supply(CallerRegistration server, CallerSession.RoutingLabels routing);
        void CheckCurrent();
    }

    // Inactive retained composition. No authenticated provisioning or dispatcher.
    internal sealed partial class CallerSession : IDisposable
    {
        private readonly object gate;
        private readonly CallerRegistration server, main;
        private readonly ICallerSetup setup;
        private CallerLauncher.Instance child;
        private EnrollmentLease enrollment;
        private CallerEndpoint endpoint;
        private bool closed, releaseAttempted, released, admissionAttempted;
        private Exception cleanupFailure;
        private RoutingLabels routing;
        internal RoutingLabels Routing { get { return routing; } }

        // Trusted-code routing labels only. No handle or protected delivery is conveyed.
        internal sealed class RoutingLabels
        {
            internal readonly string Locator, Session, Generation;
            internal RoutingLabels(CallerEndpoint channel, CallerRegistration registration)
            { Locator = channel.LocalLocator; Session = registration.Session; Generation = registration.Generation; }
        }
        internal sealed class Context
        {
            private readonly CallerSession owner;
            private readonly CallerAdmission.Context admitted;
            internal string RequestId { get { return admitted.RequestId; } }
            internal Context(CallerSession session, CallerAdmission.Context caller)
            { owner = session; admitted = caller; }
            internal void CheckCurrent() { owner.CheckContext(admitted); }
        }
        private CallerSession()
        { gate = new object(); server = null; main = null; setup = null; }

        internal static CallerSession Prepare(string root, int imageSize, string imageHash,
            string session, CallerLauncherNative native = null)
        { return PrepareCore(root, imageSize, imageHash, session, null, native); }
#if ENROLLMENT_LEASE_TEST
        internal static CallerSession PrepareForTest(string root, int imageSize, string imageHash,
            string session, IEnrollmentFiles files, CallerLauncherNative native = null)
        {
            CallerNative.Require(files != null);
            return PrepareCore(root, imageSize, imageHash, session, files, native);
        }
#endif
        private static CallerSession PrepareCore(string root, int imageSize, string imageHash,
            string session, IEnrollmentFiles files, CallerLauncherNative native,
            CallerSession result = null)
        {
            result = result ?? new CallerSession();
            try
            {
                result.CheckAuthority();
                result.child = CallerLauncher.Prepare(Path.Combine(root, "aegis-session.exe"), imageSize, imageHash, session, native);
#if ENROLLMENT_LEASE_TEST
                result.enrollment = files == null ? result.child.AcquireEnrollment(root)
                    : result.child.AcquireEnrollmentForTest(root, files);
#else
                CallerNative.Require(files == null);
                result.enrollment = result.child.AcquireEnrollment(root);
#endif
                result.endpoint = result.child.CreateEndpoint();
                result.routing = new RoutingLabels(result.endpoint, result.child.Registration);
                if (result.setup != null) result.setup.Supply(result.server, result.Routing);
                result.CheckOwnerCurrent();
                return result;
            }
            catch { result.Close(); throw; }
        }
        // Lock order: composition (shared with server registration for bootstrap) -> each inner owner.
        // The optional transport check takes no owner locks or callbacks.
        // The two registration objects are independently retained from the same created process.
        private void CheckAuthority()
        {
            if (server != null) server.CheckCurrent();
            if (main != null) main.CheckMain(server, child == null ? null : child.Registration);
        }
        private void CheckOwnerCurrent()
        {
            CallerNative.Require(!closed && !CallerNative.HasThreadToken());
            CheckAuthority();
            if (setup != null) setup.CheckCurrent();
            enrollment.CheckCurrent();
            child.CheckCurrent();
            endpoint.CheckCurrent();
            CallerNative.Require(!CallerNative.HasThreadToken());
        }
        internal void Release()
        {
            lock (gate)
            {
                // A duplicate consumes no new attempt and leaves the released child owned.
                CallerNative.Require(!closed && !releaseAttempted);
                releaseAttempted = true;
                try
                {
                    CheckOwnerCurrent();
                    child.Release();
                    released = true;
                }
                catch { Close(); throw; }
            }
        }
        internal Context Accept(int timeoutMilliseconds)
        {
            lock (gate)
            {
                try
                {
                    CallerNative.Require(!closed && released && !admissionAttempted);
                    admissionAttempted = true;
                    CheckOwnerCurrent();
                    CallerAdmission.Context admitted = endpoint.Accept(timeoutMilliseconds);
                    CheckOwnerCurrent(); admitted.CheckCurrent();
                    return new Context(this, admitted);
                }
                catch { Close(); throw; }
            }
        }
        private void CheckContext(CallerAdmission.Context admitted)
        {
            lock (gate)
            {
                try
                {
                    CallerNative.Require(released && admissionAttempted);
                    CheckOwnerCurrent(); admitted.CheckCurrent();
                }
                catch { Close(); throw; }
            }
        }
        private void CloseResource(IDisposable value)
        {
            if (value != null) try { value.Dispose(); }
            catch (Exception error) { if (cleanupFailure == null) cleanupFailure = error; }
        }
        private void Close()
        {
            if (!closed)
            {
                closed = true;
                // Always reach confirmed owned stop even if an earlier resource close fails.
                CloseResource(endpoint); CloseResource(enrollment); CloseResource(child); CloseResource(setup);
            }
            if (cleanupFailure != null)
                throw new InvalidOperationException("caller-session-cleanup-unconfirmed", cleanupFailure);
        }
        internal void Revoke() { Dispose(); }
        public void Dispose() { lock (gate) Close(); }
    }
}
