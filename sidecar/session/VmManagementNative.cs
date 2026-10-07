using System;
using System.Management;
using System.Threading;

namespace Aegis.ProtectedSession
{
    // Local VMMS operations only. Native fixture construction supplies the selected
    // newly-created VM. Protected inventory/caller admission is not implemented here.
    internal sealed class VmManagementNative : IVmManagement
    {
        private const string Namespace = @"root\virtualization\v2";
        private readonly ManagementScope scope;
        private readonly ManagementPath vmPath;
        private string capturedIdentity;
        private bool disposed;
        public Guid VmId { get; private set; }

        internal VmManagementNative(Guid id)
        {
            if (id == Guid.Empty) throw new InvalidOperationException("vm-id-invalid");
            VmId = id;
            scope = new ManagementScope(@"\\.\" + Namespace);
            scope.Connect();
            vmPath = new ManagementPath("Msvm_ComputerSystem.CreationClassName=\"Msvm_ComputerSystem\",Name=\"" +
                id.ToString("D") + "\"");
        }

        internal static ManagementPath ValidatePath(string text, string expectedClass)
        {
            if (String.IsNullOrEmpty(text) || text.Length > 2048 || text.IndexOf('\0') >= 0)
                throw new InvalidOperationException("vm-provider-path-invalid");
            var path = new ManagementPath(text);
            if (!path.IsInstance || !String.Equals(path.ClassName, expectedClass, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(path.NamespacePath, Namespace, StringComparison.OrdinalIgnoreCase) ||
                !(path.Server == "." || String.Equals(path.Server, Environment.MachineName, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("vm-provider-path-invalid");
            return path;
        }

        internal static ushort UInt16Value(object value)
        {
            if (!(value is ushort)) throw new InvalidOperationException("vm-provider-field-invalid");
            return (ushort)value;
        }

        internal static uint UInt32Value(object value)
        {
            if (!(value is uint)) throw new InvalidOperationException("vm-provider-field-invalid");
            return (uint)value;
        }

        internal static ushort? JobError(ushort state, object value)
        {
            // A running job may not have an error yet. Missing terminal fields
            // cannot establish successful completion or clear pending intent.
            if (value == null && ((state >= 2 && state <= 6) || state == 11)) return null;
            return UInt16Value(value);
        }

        private ManagementObject Open(ManagementPath path)
        {
            if (disposed) throw new InvalidOperationException("vm-manager-closed");
            var options = new ObjectGetOptions(); options.Timeout = TimeSpan.FromSeconds(3);
            var value = new ManagementObject(scope, new ManagementPath(path.RelativePath), options);
            try { value.Get(); return value; }
            catch { value.Dispose(); throw; }
        }

        private string Identity(ManagementObject vm)
        {
            ValidatePath(vm.Path.Path, "Msvm_ComputerSystem");
            Guid observed;
            if (!Guid.TryParseExact(vm["Name"] as string, "D", out observed) || observed != VmId ||
                !String.Equals(vm["CreationClassName"] as string, "Msvm_ComputerSystem", StringComparison.Ordinal))
                throw new InvalidOperationException("vm-provider-identity-invalid");
            string settingsIdentity = null;
            int realized = 0, total = 0;
            using (var settings = vm.GetRelated("Msvm_VirtualSystemSettingData"))
                foreach (ManagementObject setting in settings)
                using (setting)
                {
                    if (++total > 64) throw new InvalidOperationException("vm-settings-quota");
                    if ((string)setting["VirtualSystemType"] != "Microsoft:Hyper-V:System:Realized") continue;
                    Guid settingId;
                    if (!Guid.TryParseExact(setting["VirtualSystemIdentifier"] as string, "D", out settingId) || settingId != VmId)
                        throw new InvalidOperationException("vm-settings-identity-invalid");
                    settingsIdentity = setting["InstanceID"] as string;
                    if (String.IsNullOrEmpty(settingsIdentity) || settingsIdentity.Length > 512)
                        throw new InvalidOperationException("vm-settings-identity-invalid");
                    realized++;
                }
            if (realized != 1) throw new InvalidOperationException("vm-settings-identity-invalid");
            return vm.Path.RelativePath.ToLowerInvariant() + "\n" + settingsIdentity;
        }

        public VmObservation Inspect()
        {
            using (var vm = Open(vmPath))
            {
                string actual = Identity(vm);
                if (capturedIdentity == null) capturedIdentity = actual;
                return new VmObservation(VmId, actual, UInt16Value(vm["EnabledState"]));
            }
        }

        public VmMethodResult RequestState(ushort state)
        {
            if (state != 2 && state != 3) throw new InvalidOperationException("vm-operation-invalid");
            using (var vm = Open(vmPath))
            {
                if (capturedIdentity == null || Identity(vm) != capturedIdentity ||
                    UInt16Value(vm["EnabledState"]) != (state == 2 ? 3 : 2))
                    throw new InvalidOperationException("vm-dispatch-identity-invalid");
                using (var input = vm.GetMethodParameters("RequestStateChange"))
                {
                    input["RequestedState"] = state;
                    var options = new InvokeMethodOptions(); options.Timeout = TimeSpan.FromSeconds(3);
                    using (var output = vm.InvokeMethod("RequestStateChange", input, options))
                    {
                        uint code = UInt32Value(output["ReturnValue"]);
                        object rawJob = output["Job"];
                        if (rawJob != null && !(rawJob is string)) throw new InvalidOperationException("vm-provider-job-invalid");
                        string job = (string)rawJob;
                        if (job != null) ValidatePath(job, "Msvm_ConcreteJob");
                        return new VmMethodResult(code, job);
                    }
                }
            }
        }

        public VmJobObservation InspectJob(string text)
        {
            ManagementPath path = ValidatePath(text, "Msvm_ConcreteJob");
            using (var job = Open(path))
            {
                ValidatePath(job.Path.Path, "Msvm_ConcreteJob");
                if (!String.Equals(job.Path.RelativePath, path.RelativePath, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("vm-job-identity-invalid");
                ushort state = UInt16Value(job["JobState"]);
                return new VmJobObservation(text, state, JobError(state, job["ErrorCode"]));
            }
        }

        public void Wait() { Thread.Sleep(50); }
        public void Dispose() { disposed = true; }
    }
}
