using System;
using System.Diagnostics;

namespace Aegis.ProtectedSession
{
    // Fixed lifecycle primitives for a trusted disposable fixture constructor.
    // A GUID is not protected ownership. Program exposes no mutation/launch API.
    internal interface IVmManagement : IDisposable
    {
        Guid VmId { get; }
        VmObservation Inspect();
        VmMethodResult RequestState(ushort state);
        VmJobObservation InspectJob(string path);
        void Wait();
    }

    internal sealed class VmObservation
    {
        internal readonly Guid VmId;
        internal readonly string Identity;
        internal readonly ushort State;
        internal VmObservation(Guid id, string identity, ushort state)
        { VmId = id; Identity = identity; State = state; }
    }

    internal sealed class VmMethodResult
    {
        internal readonly uint Code;
        internal readonly string JobPath;
        internal VmMethodResult(uint code, string path) { Code = code; JobPath = path; }
    }

    internal sealed class VmJobObservation
    {
        internal readonly string Path;
        internal readonly ushort State;
        internal readonly ushort? ErrorCode;
        internal VmJobObservation(string path, ushort state, ushort? error)
        { Path = path; State = state; ErrorCode = error; }
    }

    // Immutable intent retained before InvokeMethod, including an unknown return.
    internal sealed class VmOperationRecord
    {
        internal readonly Guid OperationId, VmId;
        internal readonly ushort RequestedState;
        internal readonly string JobPath;
        internal readonly uint? ReturnCode;
        internal readonly bool Unresolved;
        internal VmOperationRecord(Guid operation, Guid vm, ushort state, string job,
            uint? code, bool unresolved)
        { OperationId = operation; VmId = vm; RequestedState = state;
          JobPath = job; ReturnCode = code; Unresolved = unresolved; }
    }

    internal sealed class OwnedVmLifecycle : IDisposable
    {
        private readonly IVmManagement management;
        private readonly object gate = new object();
        private readonly string identity;
        private readonly int deadlineMs;
        private bool startAttempted, disposed, observationFailed;
        private VmOperationRecord pending, last;
        internal string FailureReason { get; private set; }
        internal int? FailureHResult { get; private set; }
        internal Guid VmId { get { return management.VmId; } }
        internal bool PendingUnknown { get { lock (gate) { return pending != null; } } }
        internal VmOperationRecord Pending { get { lock (gate) { return pending; } } }
        internal VmOperationRecord LastOperation { get { lock (gate) { return last; } } }

        internal static OwnedVmLifecycle ForTrustedFixture(Guid id)
        {
            var native = new VmManagementNative(id);
            try { return new OwnedVmLifecycle(native, 15000); }
            catch { native.Dispose(); throw; }
        }

        // Internal DI seam; fake providers establish ordering only, not OS authority.
        internal OwnedVmLifecycle(IVmManagement provider, int timeoutMs)
        {
            if (provider == null || provider.VmId == Guid.Empty || timeoutMs < 20 || timeoutMs > 15000)
                throw new InvalidOperationException("vm-context-invalid");
            management = provider; deadlineMs = timeoutMs;
            VmObservation initial = provider.Inspect();
            if (initial == null || initial.VmId != VmId || initial.State != 3 ||
                String.IsNullOrEmpty(initial.Identity) || initial.Identity.Length > 2048)
                throw new InvalidOperationException("vm-initial-state-invalid");
            identity = initial.Identity;
        }

        private VmObservation InspectOwned()
        {
            try
            {
                VmObservation observed = management.Inspect();
                if (observed == null || observed.VmId != VmId ||
                    !String.Equals(identity, observed.Identity, StringComparison.Ordinal))
                    throw new InvalidOperationException();
                return observed;
            }
            catch (Exception error) {
                observationFailed = true;
                RecordFailure("vm-observation-unavailable", error);
                throw new InvalidOperationException("vm-observation-unavailable");
            }
        }

        internal bool ObserveOff()
        {
            lock (gate)
            {
                if (disposed || pending != null || observationFailed) return false;
                try { return InspectOwned().State == 3; }
                catch { return false; }
            }
        }

        internal bool Start()
        {
            lock (gate)
            {
                if (disposed || startAttempted || pending != null || observationFailed)
                    throw new InvalidOperationException("vm-start-unavailable");
                startAttempted = true;
                if (InspectOwned().State != 3) throw new InvalidOperationException("vm-start-phase-invalid");
                return Transition(2);
            }
        }

        internal bool Stop()
        {
            lock (gate)
            {
                // A timed-out start can still complete. Never overwrite unresolved work.
                if (disposed || pending != null || observationFailed)
                    throw new InvalidOperationException("vm-stop-unavailable");
                ushort state = InspectOwned().State;
                if (state == 3) return true;
                if (state != 2) throw new InvalidOperationException("vm-stop-phase-invalid");
                return Transition(3);
            }
        }

        private bool Transition(ushort requested)
        {
            var timer = Stopwatch.StartNew();
            Guid operationId = Guid.NewGuid();
            pending = new VmOperationRecord(operationId, VmId, requested, null, null, true);
            last = pending;
            try
            {
                VmMethodResult result = management.RequestState(requested);
                if (result == null) return false;
                pending = new VmOperationRecord(operationId, VmId, requested,
                    result.JobPath, result.Code, true);
                last = pending;
                if (result.Code == 0)
                {
                    if (result.JobPath != null) return false;
                    Settle(operationId, requested, result, null);
                    return InspectOwned().State == requested;
                }
                if (result.Code != 4096)
                {
                    // Documented rejection codes are terminal; unknown codes retain intent.
                    if (result.Code >= 32768 && result.Code <= 32778 && result.JobPath == null)
                        Settle(operationId, requested, result, null);
                    return false;
                }
                if (String.IsNullOrEmpty(result.JobPath)) return false;
                while (timer.ElapsedMilliseconds < deadlineMs)
                {
                    VmJobObservation job = management.InspectJob(result.JobPath);
                    if (job == null || !String.Equals(job.Path, result.JobPath, StringComparison.Ordinal))
                        return false;
                    if (job.State == 7 || job.State == 8)
                    {
                        Settle(operationId, requested, result, result.JobPath);
                        // A failed terminal job can leave the VM running; caller may stop
                        // only after this actual settlement, then independently observe Off.
                        return job.State == 7 && job.ErrorCode == 0 && InspectOwned().State == requested;
                    }
                    // Killed/Exception do not prove underlying work has ended.
                    if (job.State < 2 || job.State > 11 || job.State == 9 || job.State == 10) return false;
                    management.Wait();
                }
                return false;
            }
            catch (Exception error) { RecordFailure("vm-provider-operation-failed", error); return false; }
            finally { timer.Stop(); }
        }

        private void RecordFailure(string reason, Exception error)
        {
            if (FailureReason != null) return;
            FailureReason = reason; FailureHResult = error.HResult;
        }

        private void Settle(Guid id, ushort state, VmMethodResult result, string job)
        {
            last = new VmOperationRecord(id, VmId, state, job, result.Code, false);
            pending = null;
        }

        public void Dispose()
        {
            lock (gate)
            {
                disposed = true;
                // Releasing WMI proxies never cancels a provider operation or clears intent.
                management.Dispose();
            }
        }
    }
}
