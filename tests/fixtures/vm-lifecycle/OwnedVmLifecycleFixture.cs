using System;
using System.Globalization;
using System.Threading;
using System.Text;
using Aegis.ProtectedSession;

// Test/cloud-only entrypoint. Native mode is called by the fixed cloud provisioner
// for its freshly created GUID. This executable is not a production launch API.
internal static class OwnedVmLifecycleFixture
{
    private sealed class Fake : IVmManagement
    {
        public Guid VmId { get { return new Guid("11111111-2222-3333-4444-555555555555"); } }
        internal string Mode, Identity = "initial";
        internal ushort State = 3, Target;
        internal int Requests, Polls;
        internal Fake(string mode) { Mode = mode; }
        public VmObservation Inspect()
        {
            if (Mode == "lost-observation" && Requests != 0) throw new InvalidOperationException();
            return new VmObservation(Mode == "foreign-vm" ? Guid.NewGuid() : VmId, Identity, State);
        }
        public VmMethodResult RequestState(ushort state)
        {
            Requests++; Target = state; Polls = 0;
            if (Mode == "unknown-method" && state == 2) { State = 2; throw new InvalidOperationException(); }
            if (Mode == "missing-result") return null;
            if (Mode == "unknown-code") return new VmMethodResult(42, null);
            if (Mode == "rejected") return new VmMethodResult(32769, null);
            if (Mode == "missing-job") return new VmMethodResult(4096, null);
            if (Mode == "sync-extra-job") return new VmMethodResult(0, "captured");
            if (Mode == "synchronous") { State = state; return new VmMethodResult(0, null); }
            return new VmMethodResult(4096, "captured");
        }
        public VmJobObservation InspectJob(string path)
        {
            Polls++;
            if (Mode == "lost-job") throw new InvalidOperationException();
            if (Mode == "foreign-job") return new VmJobObservation("other", 7, 0);
            if (Mode == "pending") return new VmJobObservation(path, 4, 0);
            if (Mode == "killed") return new VmJobObservation(path, 9, 0);
            if (Mode == "exception") return new VmJobObservation(path, 10, 0);
            if (Mode == "unknown-state") return new VmJobObservation(path, 12, 0);
            if (Mode == "null-terminal-error") return new VmJobObservation(path, 7, VmManagementNative.JobError(7, null));
            if (Mode == "null-running-error" && Polls == 1) return new VmJobObservation(path, 4, VmManagementNative.JobError(4, null));
            if (Mode == "failed-running" && Target == 2) { State = 2; return new VmJobObservation(path, 8, 5); }
            if (Mode == "error-running" && Target == 2) { State = 2; return new VmJobObservation(path, 7, 5); }
            if (Polls == 1) return new VmJobObservation(path, 3, 0);
            State = Mode == "wrong-final" && Target == 2 ? (ushort)4 : Target;
            return new VmJobObservation(path, 7, 0);
        }
        public void Wait() { Thread.Sleep(10); }
        public void Dispose() { }
    }

    private static string Boolean(bool value) { return value ? "true" : "false"; }
    private static string Code(VmOperationRecord value)
    { return value == null || !value.ReturnCode.HasValue ? "null" : value.ReturnCode.Value.ToString(CultureInfo.InvariantCulture); }

    private static string JsonText(string value)
    {
        if (value == null) return "null";
        var text = new StringBuilder("\"");
        foreach (char c in value) {
            if (c == '\\' || c == '"') text.Append('\\').Append(c);
            else if (c < 32) text.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            else text.Append(c);
        }
        return text.Append('"').ToString();
    }

    private static int Native(Guid id)
    {
        OwnedVmLifecycle owner = null;
        VmOperationRecord start = null, stop = null;
        bool running = false, off = false, pending = false, stopped = false;
        int? initialHResult = null;
        try
        {
            owner = OwnedVmLifecycle.ForTrustedFixture(id);
            running = owner.Start(); start = owner.LastOperation;
        }
        catch (Exception error) { initialHResult = error.HResult; }
        finally
        {
            if (owner != null)
            {
                if (!owner.PendingUnknown)
                {
                    try
                    {
                        stopped = owner.Stop();
                        if (owner.LastOperation != null && owner.LastOperation.RequestedState == 3)
                            stop = owner.LastOperation;
                    }
                    catch { }
                }
                pending = owner.PendingUnknown;
                off = owner.ObserveOff();
                owner.Dispose();
            }
        }
        bool cleanup = owner != null && !pending && off;
        bool passed = running && stopped && cleanup && stop != null;
        string phase = owner == null ? "initial-observation" : !running ? "start" : !stopped ? "stop" : !off ? "off-observation" : "complete";
        string reason = passed ? null : owner != null && owner.FailureReason != null ? owner.FailureReason : "vm-lifecycle-not-confirmed";
        int? hresult = owner == null ? initialHResult : owner.FailureHResult;
        VmOperationRecord diagnostic = owner == null ? null : owner.Pending ?? (!running ? start : stop ?? start);
        Console.WriteLine("{\"schemaVersion\":1,\"scope\":\"native-hyper-v-fixture-lifecycle\",\"vmId\":\"" + id.ToString("D") +
            "\",\"passed\":" + Boolean(passed) + ",\"runningObserved\":" + Boolean(running) +
            ",\"offObserved\":" + Boolean(off) + ",\"pendingUnknown\":" + Boolean(pending) +
            ",\"cleanupKnown\":" + Boolean(cleanup) + ",\"startReturnCode\":" + Code(start) +
            ",\"stopReturnCode\":" + Code(stop) + ",\"startJobCaptured\":" + Boolean(start != null && start.JobPath != null) +
            ",\"stopJobCaptured\":" + Boolean(stop != null && stop.JobPath != null) +
            ",\"guestBoot\":\"not-run-empty-firmware\",\"launchAllowed\":false,\"diagnostic\":{\"phase\":" + JsonText(phase) +
            ",\"reason\":" + JsonText(reason) + ",\"hresult\":" + (hresult.HasValue ? hresult.Value.ToString(CultureInfo.InvariantCulture) : "null") +
            ",\"operationId\":" + JsonText(diagnostic == null ? null : diagnostic.OperationId.ToString("D")) +
            ",\"jobPath\":" + JsonText(diagnostic == null ? null : diagnostic.JobPath) + "}}");
        // The receipt preserves known failures; the parent validates the closed shape.
        return 0;
    }

    private static int Test(string mode)
    {
        if (mode.StartsWith("field-", StringComparison.Ordinal))
        {
            object value = null;
            if (mode.EndsWith("-valid", StringComparison.Ordinal)) value = mode.Contains("32") ? (object)0U : (object)(ushort)0;
            if (mode.EndsWith("-string", StringComparison.Ordinal)) value = "0";
            if (mode.EndsWith("-int", StringComparison.Ordinal)) value = 0;
            if (mode.EndsWith("-bool", StringComparison.Ordinal)) value = false;
            bool accepted = false;
            try
            {
                if (mode.Contains("32")) VmManagementNative.UInt32Value(value);
                else VmManagementNative.UInt16Value(value);
                accepted = true;
            }
            catch { }
            Console.WriteLine("{\"accepted\":" + Boolean(accepted) + "}"); return 0;
        }
        if (mode.StartsWith("path-", StringComparison.Ordinal))
        {
            string path = @"\\.\root\virtualization\v2:Msvm_ConcreteJob.InstanceID=""job""";
            if (mode == "path-remote") path = path.Replace(@"\\.\", @"\\foreign-host\");
            if (mode == "path-namespace") path = path.Replace(@"virtualization\v2", "cimv2");
            if (mode == "path-class") path = path.Replace("Msvm_ConcreteJob", "Win32_Process");
            if (mode == "path-relative") path = "Msvm_ConcreteJob.InstanceID=\"job\"";
            bool accepted = false;
            try { VmManagementNative.ValidatePath(path, "Msvm_ConcreteJob"); accepted = true; } catch { }
            Console.WriteLine("{\"accepted\":" + Boolean(accepted) + "}"); return 0;
        }
        var provider = new Fake(mode);
        OwnedVmLifecycle owner = null;
        bool started = false, repeat = false, stopped = false, off = false, pending = false, stable = false;
        try
        {
            owner = new OwnedVmLifecycle(provider, 40);
            if (mode == "replaced") provider.Identity = "replacement";
            try { started = owner.Start(); } catch { }
            VmOperationRecord record = owner.Pending;
            try { repeat = owner.Start(); } catch { }
            try { stopped = owner.Stop(); } catch { }
            pending = owner.PendingUnknown; off = owner.ObserveOff();
            stable = record == null || Object.ReferenceEquals(record, owner.Pending);
        }
        catch { }
        finally { if (owner != null) owner.Dispose(); }
        Console.WriteLine("{\"started\":" + Boolean(started) + ",\"repeat\":" + Boolean(repeat) +
            ",\"stopped\":" + Boolean(stopped) + ",\"off\":" + Boolean(off) +
            ",\"pending\":" + Boolean(pending) + ",\"recordStable\":" + Boolean(stable) +
            ",\"requests\":" + provider.Requests + "}");
        return 0;
    }

    private static int Main(string[] args)
    {
        try
        {
            Guid id;
            if (args.Length == 2 && args[0] == "native" && Guid.TryParseExact(args[1], "D", out id) &&
                id != Guid.Empty && id.ToString("D") == args[1]) return Native(id);
            if (args.Length == 1 && args[0] != "native") return Test(args[0]);
        }
        catch { }
        return 2;
    }
}
