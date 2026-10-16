using System;
using System.Collections.Generic;
using System.Management;

namespace Aegis.ProtectedSession
{
    internal sealed partial class VmManagementNative : IVmConfigurationSource
    {
        // This uses the original manager's identity and disposal state. No query
        // accepts a name, remote endpoint, caller-selected settings or mutation.
        public VmConfigurationObservation ReadConfiguration()
        {
            return VmConfigurationRead.Observe(VmId, capturedIdentity, ConfigurationFence, ConfigurationData);
        }

        private VmObservation ConfigurationFence()
        {
            using (var vm = Open(vmPath))
                return new VmObservation(VmId, ConfigurationIdentity(vm), UInt16Value(vm["EnabledState"]));
        }

        private VmConfigurationData ConfigurationData()
        {
            using (var vm = Open(vmPath))
            {
                if (capturedIdentity == null || UInt16Value(vm["EnabledState"]) != 3 || ConfigurationIdentity(vm) != capturedIdentity)
                    throw new InvalidOperationException("installed-vm-configuration-unavailable");
                VmConfigurationData data = null;
                using (var settings = ConfigurationRelated(vm, "Msvm_VirtualSystemSettingData", null))
                {
                    int count = 0;
                    foreach (ManagementObject setting in settings)
                    using (setting)
                    {
                        // Any extra settings (including snapshots/recovery) refuse.
                        if (++count != 1) throw new InvalidOperationException("installed-vm-configuration-unavailable");
                        ValidatePath(setting.Path.Path, "Msvm_VirtualSystemSettingData");
                        data = new VmConfigurationData { VmId = VmId, Identity = capturedIdentity,
                            SettingsPath = setting.Path.Path, Settings = ConfigurationValues(setting, new[] {
                                "InstanceID", "VirtualSystemIdentifier", "VirtualSystemType", "VirtualSystemSubType",
                                "AutomaticStartupAction", "AutomaticShutdownAction", "AutomaticSnapshotsEnabled",
                                "UserSnapshotType", "SecureBootEnabled" }) };
                        using (var resources = ConfigurationRelated(setting, "CIM_ResourceAllocationSettingData", "Msvm_VirtualSystemSettingDataComponent"))
                            foreach (ManagementObject resource in resources)
                            using (resource)
                            {
                                if (data.Resources.Count >= 256) throw new InvalidOperationException("vm-configuration-quota");
                                string name = resource.ClassPath.ClassName;
                                ValidatePath(resource.Path.Path, name);
                                var values = ConfigurationValues(resource, new[] { "InstanceID", "ResourceType", "ResourceSubType" });
                                string[] fields = new string[0];
                                if (name == "Msvm_MemorySettingData") fields = new[] { "DynamicMemoryEnabled", "VirtualQuantity", "VirtualQuantityUnits" };
                                else if (name == "Msvm_ProcessorSettingData") fields = new[] { "VirtualQuantity" };
                                else if (name == "Msvm_StorageAllocationSettingData") fields = new[] { "Parent", "HostResource" };
                                else if (name == "Msvm_ResourceAllocationSettingData") fields = new[] { "Parent", "Address", "AddressOnParent" };
                                foreach (string field in fields) values.Add(field, resource[field]);
                                data.Resources.Add(new VmConfigurationResource(name, resource.Path.Path, values));
                            }
                    }
                }
                return data;
            }
        }

        private string ConfigurationIdentity(ManagementObject vm)
        {
            ValidatePath(vm.Path.Path, "Msvm_ComputerSystem");
            if (!String.Equals(vm.Path.RelativePath, vmPath.RelativePath, StringComparison.OrdinalIgnoreCase) ||
                !(vm["Name"] is string) || (string)vm["Name"] != VmId.ToString("D") ||
                !(vm["CreationClassName"] is string) || (string)vm["CreationClassName"] != "Msvm_ComputerSystem")
                throw new InvalidOperationException("vm-provider-identity-invalid");
            string identity = null;
            using (var settings = ConfigurationRelated(vm, "Msvm_VirtualSystemSettingData", null))
                foreach (ManagementObject setting in settings)
                using (setting)
                {
                    if (identity != null || !(setting["VirtualSystemType"] is string) ||
                        (string)setting["VirtualSystemType"] != "Microsoft:Hyper-V:System:Realized" ||
                        !(setting["VirtualSystemIdentifier"] is string) || (string)setting["VirtualSystemIdentifier"] != VmId.ToString("D"))
                        throw new InvalidOperationException("vm-settings-identity-invalid");
                    ValidatePath(setting.Path.Path, "Msvm_VirtualSystemSettingData");
                    identity = vm.Path.RelativePath.ToLowerInvariant() + "\n" + VmConfigurationProfile.Text(setting["InstanceID"] as string);
                }
            if (identity == null) throw new InvalidOperationException("vm-settings-identity-invalid");
            return identity;
        }

        private static Dictionary<string, object> ConfigurationValues(ManagementObject value, string[] names)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (string name in names) result.Add(name, value[name]);
            return result;
        }

        private static ManagementObjectCollection ConfigurationRelated(ManagementObject value, string name, string association)
        {
            var options = new EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), BlockSize = 1,
                Rewindable = false, ReturnImmediately = false };
            return value.GetRelated(name, association, null, null, null, null, false, options);
        }
    }
}
