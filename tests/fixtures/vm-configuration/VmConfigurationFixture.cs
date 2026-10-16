using System;
using System.Collections.Generic;
using Aegis.ProtectedSession;

// Modeled provider records + real inbox ManagementPath parsing only. This does
// not query Hyper-V, install authority, create a VM or dispatch a guest.
internal static class VmConfigurationFixture
{
    private static readonly Guid Id = new Guid("11111111-2222-3333-4444-555555555555");
    private const string Prefix = "Microsoft:Hyper-V:";
    private const string SettingsId = "Microsoft:original-realized-settings";
    private static readonly string Identity = "msvm_computersystem.creationclassname=\"msvm_computersystem\",name=\"" + Id.ToString("D") + "\"\n" + SettingsId;
    private static string Path(string name, string id)
    { return @"\\.\root\virtualization\v2:" + name + ".InstanceID=\"" + id.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
    private static VmConfigurationResource Row(string name, string id, ushort type, string subtype)
    {
        return new VmConfigurationResource(name, Path(name, id), new Dictionary<string, object> {
            { "InstanceID", id }, { "ResourceType", type }, { "ResourceSubType", Prefix + subtype } });
    }
    private static VmConfigurationData Good()
    {
        var data = new VmConfigurationData { VmId = Id, Identity = Identity,
            SettingsPath = Path("Msvm_VirtualSystemSettingData", SettingsId),
            Settings = new Dictionary<string, object> {
                { "InstanceID", SettingsId }, { "VirtualSystemIdentifier", Id.ToString("D") },
                { "VirtualSystemType", Prefix + "System:Realized" }, { "VirtualSystemSubType", Prefix + "SubType:2" },
                { "AutomaticStartupAction", (ushort)2 }, { "AutomaticShutdownAction", (ushort)2 },
                { "AutomaticSnapshotsEnabled", false }, { "UserSnapshotType", (ushort)2 }, { "SecureBootEnabled", true } } };
        var memory = Row("Msvm_MemorySettingData", "memory", 4, "Memory");
        memory.Values.Add("DynamicMemoryEnabled", false); memory.Values.Add("VirtualQuantity", (ulong)4096);
        memory.Values.Add("VirtualQuantityUnits", "byte * 2^20");
        var cpu = Row("Msvm_ProcessorSettingData", "cpu", 3, "Processor"); cpu.Values.Add("VirtualQuantity", (ulong)2);
        var controller = Row("Msvm_ResourceAllocationSettingData", "controller", 6, "Synthetic SCSI Controller"); controller.Values.Add("Address", "0");
        var disk = Row("Msvm_ResourceAllocationSettingData", "disk-drive", 17, "Synthetic Disk Drive");
        disk.Values.Add("Parent", controller.Path); disk.Values.Add("AddressOnParent", "0");
        var dvd = Row("Msvm_ResourceAllocationSettingData", "dvd-drive", 16, "Synthetic DVD Drive");
        dvd.Values.Add("Parent", controller.Path); dvd.Values.Add("AddressOnParent", "7");
        var diskFile = Row("Msvm_StorageAllocationSettingData", "disk-file", 31, "Virtual Hard Disk");
        diskFile.Values.Add("Parent", disk.Path); diskFile.Values.Add("HostResource", new[] { @"X:\private\disk.vhdx" });
        var dvdFile = Row("Msvm_StorageAllocationSettingData", "dvd-file", 31, "Virtual CD/DVD Disk");
        dvdFile.Values.Add("Parent", dvd.Path); dvdFile.Values.Add("HostResource", new[] { @"X:\private\original.iso" });
        data.Resources.AddRange(new[] { memory, cpu, controller, disk, dvd, diskFile, dvdFile });
        return data;
    }
    private static VmConfigurationResource WithId(VmConfigurationResource row, string id)
    {
        var values = new Dictionary<string, object>(row.Values); values["InstanceID"] = id;
        return new VmConfigurationResource(row.ClassName, Path(row.ClassName, id), values);
    }
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        string mode = args[0]; var data = Good();
        var baseline = VmConfigurationProfile.Validate(data, Id, Identity);
        if (mode == "reorder") data.Resources.Reverse();
        if (mode == "gen1") data.Settings["VirtualSystemSubType"] = Prefix + "SubType:1";
        if (mode == "auto-start") data.Settings["AutomaticStartupAction"] = (ushort)4;
        if (mode == "auto-stop") data.Settings["AutomaticShutdownAction"] = (ushort)3;
        if (mode == "auto-checkpoint") data.Settings["AutomaticSnapshotsEnabled"] = true;
        if (mode == "checkpoint") data.Settings["UserSnapshotType"] = (ushort)5;
        if (mode == "secure-boot") data.Settings["SecureBootEnabled"] = false;
        if (mode == "snapshot") data.Settings["VirtualSystemType"] = Prefix + "Snapshot:Realized";
        if (mode == "missing") data.Settings.Remove("SecureBootEnabled");
        if (mode == "null") data.Settings["SecureBootEnabled"] = null;
        if (mode == "flag-type") data.Settings["SecureBootEnabled"] = "true";
        if (mode == "enum-type") data.Settings["AutomaticStartupAction"] = (uint)2;
        if (mode == "wrong-vm") data.VmId = Guid.NewGuid();
        if (mode == "foreign-settings") data.Settings["VirtualSystemIdentifier"] = Guid.NewGuid().ToString("D");
        if (mode == "settings-replaced") data.Settings["InstanceID"] = "replacement";
        if (mode == "memory") data.Resources[0].Values["VirtualQuantity"] = (ulong)2048;
        if (mode == "memory-type") data.Resources[0].Values["VirtualQuantity"] = (uint)4096;
        if (mode == "memory-units") data.Resources[0].Values["VirtualQuantityUnits"] = "byte";
        if (mode == "dynamic") data.Resources[0].Values["DynamicMemoryEnabled"] = true;
        if (mode == "cpu") data.Resources[1].Values["VirtualQuantity"] = (ulong)4;
        if (mode == "cpu-type") data.Resources[1].Values["VirtualQuantity"] = 2;
        if (mode == "duplicate") data.Resources.Add(data.Resources[0]);
        if (mode == "duplicate-id") data.Resources.Add(new VmConfigurationResource("Msvm_MemorySettingData", Path("Msvm_MemorySettingData", "other"), data.Resources[0].Values));
        if (mode == "duplicate-memory") data.Resources.Add(WithId(data.Resources[0], "memory-2"));
        if (mode == "missing-cpu") data.Resources.RemoveAt(1);
        if (mode == "quota") for (int i = 0; i < 257; i++) data.Resources.Add(data.Resources[0]);
        if (mode == "nic") data.Resources.Add(Row("Msvm_SyntheticEthernetPortSettingData", "nic", 10, "Synthetic Ethernet Port"));
        if (mode == "legacy-nic") data.Resources.Add(Row("Msvm_EmulatedEthernetPortSettingData", "nic", 10, "Emulated Ethernet Port"));
        if (mode == "unsupported") data.Resources.Add(Row("Msvm_ResourceAllocationSettingData", "usb", 23, "USB Controller"));
        if (mode == "orphan-resource") data.Resources.Add(Row("Msvm_ResourceAllocationSettingData", "orphan", 17, "Synthetic Disk Drive"));
        if (mode == "orphan-nic") data.Resources.Add(Row("Msvm_EthernetPortAllocationSettingData", "orphan", 33, "Ethernet Connection"));
        if (mode == "physical") data.Resources[3].Values["ResourceSubType"] = Prefix + "Physical Disk Drive";
        if (mode == "disk-slot") data.Resources[3].Values["AddressOnParent"] = "1";
        if (mode == "controller-slot") data.Resources[2].Values["Address"] = "1";
        if (mode == "controller-range") data.Resources[2].Values["Address"] = "4";
        if (mode == "dvd-type") data.Resources[4].Values["ResourceType"] = (ushort)15;
        if (mode == "slot-alias") data.Resources[4].Values["AddressOnParent"] = "07";
        if (mode == "slot-collision") data.Resources[4].Values["AddressOnParent"] = "0";
        if (mode == "foreign-parent") data.Resources[4].Values["Parent"] = Path("Msvm_ResourceAllocationSettingData", "foreign");
        if (mode == "foreign-drive") data.Resources[6].Values["Parent"] = data.Resources[3].Path;
        if (mode == "missing-dvd") data.Resources.RemoveAt(6);
        if (mode == "empty-dvd") data.Resources[6].Values["HostResource"] = new string[0];
        if (mode == "multi-host") data.Resources[5].Values["HostResource"] = new[] { @"X:\a.vhdx", @"X:\b.vhdx" };
        if (mode == "host-type") data.Resources[5].Values["HostResource"] = @"X:\a.vhdx";
        if (mode == "relative-host") data.Resources[5].Values["HostResource"] = new[] { "a.vhdx" };
        if (mode == "duplicate-host") data.Resources[6].Values["HostResource"] = data.Resources[5].Values["HostResource"];
        if (mode == "stream-host") data.Resources[5].Values["HostResource"] = new[] { @"X:\private\disk.vhdx:stream" };
        if (mode == "remote-parent") data.Resources[4].Values["Parent"] = data.Resources[2].Path.Replace(@"\\.\", @"\\foreign\");
        if (mode == "wrong-namespace") data.Resources[4].Values["Parent"] = data.Resources[2].Path.Replace(@"virtualization\v2", "cimv2");
        if (mode == "wrong-class") data.Resources[4].Values["Parent"] = Path("Msvm_ComputerSystem", "controller");
        if (mode == "changed-dvd-slot") data.Resources[4].Values["AddressOnParent"] = "9";
        if (mode == "changed-image") data.Resources[6].Values["HostResource"] = new[] { @"X:\private\replacement.iso" };
        if (mode == "changed-controller")
        {
            data.Resources[2] = WithId(data.Resources[2], "replacement-controller");
            data.Resources[3].Values["Parent"] = data.Resources[2].Path; data.Resources[4].Values["Parent"] = data.Resources[2].Path;
        }
        if (mode == "changed-drive")
        { data.Resources[4] = WithId(data.Resources[4], "replacement-dvd"); data.Resources[6].Values["Parent"] = data.Resources[4].Path; }
        if (mode == "boot-tpm")
        { data.Settings["BootSourceOrder"] = new[] { "changed-by-authorized-bootdisk" }; data.Settings["TpmProtector"] = "authorized-rekey"; }
        bool accepted = false, same = false;
        try
        {
            int fences = 0;
            var observed = VmConfigurationRead.Observe(Id, Identity, delegate {
                fences++;
                if (mode == "null-fence") return null;
                return new VmObservation(mode == "vm-after" && fences == 2 ? Guid.NewGuid() : Id,
                    mode == "identity-after" && fences == 2 ? Identity + "replacement" : Identity,
                    (ushort)(((mode == "state-before" && fences == 1) || (mode == "state-after" && fences == 2)) ? 2 : 3));
            }, delegate { return data; });
            accepted = observed.Profile == VmConfigurationProfile.Name && observed.VmId == Id && observed.Identity == Identity;
            same = observed.Digest == baseline.Digest;
        }
        catch (InvalidOperationException) { }
        Console.WriteLine("{\"accepted\":" + (accepted ? "true" : "false") + ",\"same\":" + (same ? "true" : "false") + "}");
        return 0;
    }
}
