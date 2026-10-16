using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

// One administrative launch attempt. This owner never authenticates a GUI route.
public sealed class ProtectedGuiProcessLease : IDisposable
{
    private const int LifetimeMilliseconds = 30 * 60 * 1000;
    private readonly ProtectedGuiBundleFiles bundle;
    private readonly ProtectedInstallFile root, parent;
    private readonly ProtectedGuiIdentity principal;
    private readonly string installId;
    private readonly object association;
    private readonly Stopwatch lifetime = Stopwatch.StartNew();
    private ProtectedGuiExecutionPins pins;
    private ProtectedGuiProcessProfile profile;
    private ProtectedGuiProcessNative process;
    private ProtectedGuiIdentity.ProcessBinding binding;
    private Timer timer;
    private bool attempted, prepared, releaseAttempted, released, settled, unknown, bound;
    private ProtectedGuiProcessNative.Observation terminal;
#if PROTECTED_GUI_PROCESS_TEST
    private string diagnosticPhase = "none", diagnosticFailurePhase = "none";
    public string FailurePhaseForTest { get { return diagnosticFailurePhase; } }
#endif
    [Conditional("PROTECTED_GUI_PROCESS_TEST")]
    private void Phase(string value) {
#if PROTECTED_GUI_PROCESS_TEST
        diagnosticPhase = value;
#endif
    }
    public bool IsSettled { get { using (principal.EnterLifecycle()) return settled && !unknown; } }
    public bool CleanupUnknown { get { using (principal.EnterLifecycle()) return unknown; } }
    public sealed class Observation {
        public string State { get; internal set; }
        public bool? RootAlive { get; internal set; }
        public uint? ActiveProcesses { get; internal set; }
        public bool Released { get; internal set; }
        public bool CleanupUnknown { get; internal set; }
        public bool ProfileDataRetained { get; internal set; }
    }
    private ProtectedGuiProcessLease(ProtectedGuiBundleFiles originalBundle, ProtectedInstallFile originalRoot,
        ProtectedInstallFile originalParent, ProtectedGuiIdentity originalPrincipal, string installation, object originalAssociation) {
        Need(originalBundle != null && originalRoot != null && originalParent != null && originalPrincipal != null && originalAssociation != null);
        bundle = originalBundle; root = originalRoot; parent = originalParent; principal = originalPrincipal; installId = installation;
        association = originalAssociation;
    }
    public static ProtectedGuiProcessLease Create(ProtectedGuiBundleFiles bundle, ProtectedInstallFile root,
        ProtectedInstallFile parent, ProtectedGuiIdentity principal, string installId, object association) {
        return new ProtectedGuiProcessLease(bundle, root, parent, principal, installId, association);
    }
    public bool OwnsAssociation(object original) { return Object.ReferenceEquals(association, original); }
    private static void Need(bool value) { if (!value) throw new InvalidDataException("protected-gui-process-refused"); }
    private Exception Unknown(Exception cause) {
#if PROTECTED_GUI_PROCESS_TEST
        if (diagnosticFailurePhase == "none") diagnosticFailurePhase = diagnosticPhase;
        cause.Data["protectedGuiProcessPhase"] = diagnosticPhase;
#endif
        unknown = true; RetireTimer();
        var failure = new InvalidDataException("protected-gui-process-cleanup-unknown", cause);
        failure.Data["protectedCleanupUnknown"] = true; return failure;
    }
    private static bool Marked(Exception error) {
        for (int depth = 0; error != null && depth < 8; depth++, error = error.InnerException)
            if (error.Data.Contains("protectedCleanupUnknown") && Object.Equals(error.Data["protectedCleanupUnknown"], true)) return true;
        return false;
    }
    private void Deadline() { Need(lifetime.ElapsedMilliseconds < LifetimeMilliseconds); }
    private void CheckOriginals(bool requireLive) {
        Phase("deadline-before"); Deadline();
        Phase("principal"); principal.CheckCurrent();
        Phase("pins"); pins.Check();
        Phase("profile"); profile.Check();
        if (requireLive) { Phase("native-live"); process.Check(); Phase("binding"); binding.Check(process); }
        else {
            Phase("native-observe"); var observed = process.GetState();
            if (observed.RootAlive) {
                try { Phase("binding"); binding.Check(process); }
                catch {
                    // A formerly live root can exit during the token query.
                    // A still-live failure remains a refusal; only the original
                    // signaled handle permits this terminal observation.
                    Phase("native-exit-reobserve"); Need(!process.GetState().RootAlive);
                }
            }
        }
        Phase("deadline-after"); Deadline();
    }
    public void Prepare() {
        using (principal.EnterLifecycle()) {
            Need(!attempted && !settled && !unknown); attempted = true;
            try {
                Deadline(); principal.BindProcess(this); bound = true;
                pins = bundle.AcquireExecution(root, parent, principal, this);
                profile = new ProtectedGuiProcessProfile(principal, installId); profile.Prepare();
#if PROTECTED_GUI_TEST && PROTECTED_GUI_PROCESS_TEST
                if (principal.IsProcessModel) process = ProtectedGuiProcessNative.PrepareForTest(pins.ImagePath, profile.PathName);
                else
#endif
                using (var token = principal.DuplicateLimitedForProcess()) process = ProtectedGuiProcessNative.Prepare(pins.ImagePath, token, profile.PathName);
                binding = ProtectedGuiIdentity.ProcessBinding.Capture(principal, process);
                CheckOriginals(true); prepared = true;
                timer = new Timer(Revoke, null, Remaining(), Timeout.Infinite);
            } catch (Exception failure) {
                // Native preparation may have created an owner before throwing.
                var nativeOwnership = failure as ProtectedGuiProcessNative.OwnershipFailure;
                var pinOwnership = failure as ProtectedGuiBundleFiles.ExecutionOwnershipFailure;
                if (process == null && nativeOwnership != null) process = nativeOwnership.Owner;
                if (pins == null && pinOwnership != null) pins = pinOwnership.Pins;
                if (Marked(failure)) { unknown = true; try { SettleJobOnly(); } catch { } throw Unknown(failure); }
                try { StopCore(); } catch (Exception cleanup) { throw Unknown(cleanup); }
                throw;
            }
        }
    }
    private int Remaining() { return (int)Math.Max(1, LifetimeMilliseconds - lifetime.ElapsedMilliseconds); }
    public void Release() {
        using (principal.EnterLifecycle()) {
            Need(prepared && !releaseAttempted && !settled && !unknown); releaseAttempted = true;
            try { CheckOriginals(true); process.Release(); released = true; CheckOriginals(false); }
            catch (Exception failure) {
                if (Marked(failure)) unknown = true;
                try { StopCore(); } catch (Exception cleanup) { throw Unknown(cleanup); }
                if (unknown) throw Unknown(failure); throw;
            }
        }
    }
    private void RetireTimer() { Timer original = timer; timer = null; if (original != null) original.Dispose(); }
    private void Revoke(object ignored) {
        using (principal.EnterLifecycle()) {
            try { RevokeCore(false); } catch (Exception failure) { Unknown(failure); }
        }
    }
    private void RevokeCore(bool modeledExpiry) {
        if (settled || unknown || timer == null) return;
        if (!modeledExpiry && lifetime.ElapsedMilliseconds < LifetimeMilliseconds) { timer.Change(Remaining(), Timeout.Infinite); return; }
        try { StopCore(); } catch (Exception failure) { throw Unknown(failure); }
    }
    private void SettleJobOnly() {
        if (process == null) return;
        Phase("native-stop"); process.Stop();
        Phase("native-observe-stopped"); terminal = process.GetState();
        Phase("native-terminal-invariant"); Need(!terminal.RootAlive && terminal.ActiveProcesses == 0);
    }
    private void StopCore() {
        RetireTimer();
        if (settled) return;
        SettleJobOnly();
        // A failed observation/transition is never converted to safe restoration.
        Phase("known-cleanup"); Need(!unknown);
        Phase("native-close"); if (process != null) process.Dispose();
        Phase("binding-close"); if (binding != null) { binding.Dispose(); binding = null; }
        Phase("pins-restore"); if (pins != null) pins.RestoreAfterJobClosed();
        Phase("profile-close"); if (profile != null) profile.Dispose();
        Phase("principal-release"); if (bound) { principal.ReleaseProcess(this); bound = false; }
        settled = true;
    }
    public void Stop() {
        using (principal.EnterLifecycle()) {
            try { StopCore(); } catch (Exception failure) { throw Unknown(failure); }
        }
    }
    public Observation GetState() {
        using (principal.EnterLifecycle()) {
            ProtectedGuiProcessNative.Observation actual = terminal;
            if (!settled && process != null) {
                try {
                    Phase("native-observe"); actual = process.GetState();
                    if (!unknown) {
                        if (lifetime.ElapsedMilliseconds >= LifetimeMilliseconds) { StopCore(); actual = terminal; }
                        else { CheckOriginals(false); actual = process.GetState(); }
                    }
                } catch (Exception failure) { Unknown(failure); try { SettleJobOnly(); actual = terminal; } catch { actual = null; } }
            }
            return new Observation { State = unknown ? "cleanup-unknown" : settled ? "stopped" : actual != null ? actual.State : "preparing",
                RootAlive = actual == null ? (bool?)null : actual.RootAlive, ActiveProcesses = actual == null ? (uint?)null : actual.ActiveProcesses,
                Released = released, CleanupUnknown = unknown, ProfileDataRetained = profile != null && profile.DataRetained };
        }
    }
    public void Dispose() { Stop(); }
#if PROTECTED_GUI_PROCESS_TEST
    public void ExpireForTest() {
        using (principal.EnterLifecycle()) RevokeCore(true);
    }
#endif
}
