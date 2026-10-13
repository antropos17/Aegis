using System;
using System.Collections.Generic;
using System.Management;

namespace Aegis.ProtectedSession
{
    internal sealed partial class VmManagementNative : IVmStorageSource
    {
        public VmStorageAttachment[] ReadStorage()
        {
            using (var vm = Open(vmPath))
            {
                if (UInt16Value(vm["EnabledState"]) != 3 || capturedIdentity == null || Identity(vm) != capturedIdentity)
                    throw new InvalidOperationException("installed-vm-storage-unavailable");
                var rows = new List<VmStorageAttachment>();
                int total = 0, realized = 0;
                using (var settings = vm.GetRelated("Msvm_VirtualSystemSettingData"))
                    foreach (ManagementObject setting in settings)
                    using (setting)
                    {
                        if (++total > 64) throw new InvalidOperationException("vm-settings-quota");
                        if ((string)setting["VirtualSystemType"] != "Microsoft:Hyper-V:System:Realized") continue;
                        ValidatePath(setting.Path.Path, "Msvm_VirtualSystemSettingData");
                        Guid id;
                        if (++realized != 1 || !Guid.TryParseExact(setting["VirtualSystemIdentifier"] as string, "D", out id) ||
                            id != VmId || vm.Path.RelativePath.ToLowerInvariant() + "\n" + (setting["InstanceID"] as string) != capturedIdentity)
                            throw new InvalidOperationException("vm-settings-identity-invalid");
                        // Refuse pass-through physical disks rather than silently
                        // omitting resources outside the virtual-file class.
                        int resources = 0;
                        using (var devices = setting.GetRelated("Msvm_ResourceAllocationSettingData"))
                            foreach (ManagementObject device in devices)
                            using (device)
                            {
                                if (++resources > 256 || device["ResourceSubType"] as string == "Microsoft:Hyper-V:Physical Disk Drive")
                                    throw new InvalidOperationException("installed-vm-storage-unavailable");
                            }
                        using (var allocations = setting.GetRelated("Msvm_StorageAllocationSettingData"))
                            foreach (ManagementObject allocation in allocations)
                            using (allocation)
                            {
                                if (rows.Count >= 16 || UInt16Value(allocation["ResourceType"]) != 31)
                                    throw new InvalidOperationException("installed-vm-storage-unavailable");
                                ValidatePath(allocation.Path.Path, "Msvm_StorageAllocationSettingData");
                                string kind = allocation["ResourceSubType"] as string;
                                if (kind == "Microsoft:Hyper-V:Virtual Hard Disk") kind = "disk";
                                else if (kind == "Microsoft:Hyper-V:Virtual CD/DVD Disk") kind = "dvd";
                                else throw new InvalidOperationException("installed-vm-storage-unavailable");
                                string[] paths = allocation["HostResource"] as string[];
                                if (paths == null || paths.Length > 1 || (kind == "disk" && paths.Length != 1))
                                    throw new InvalidOperationException("installed-vm-storage-unavailable");
                                string parent = allocation["Parent"] as string;
                                ManagementPath parentPath = ValidatePath(parent, "Msvm_ResourceAllocationSettingData");
                                using (var drive = Open(parentPath))
                                {
                                    if (!String.Equals(drive.Path.RelativePath, parentPath.RelativePath, StringComparison.OrdinalIgnoreCase))
                                        throw new InvalidOperationException("installed-vm-storage-unavailable");
                                    rows.Add(new VmStorageAttachment(allocation["InstanceID"] as string, kind,
                                        parentPath.RelativePath.ToLowerInvariant(), drive["AddressOnParent"] as string,
                                        paths.Length == 0 ? "" : paths[0]));
                                }
                            }
                    }
                if (realized != 1 || Identity(vm) != capturedIdentity || UInt16Value(vm["EnabledState"]) != 3)
                    throw new InvalidOperationException("installed-vm-storage-unavailable");
                return rows.ToArray();
            }
        }
    }
}
