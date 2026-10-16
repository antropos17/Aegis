using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Management;
using System.Security.Cryptography;
using System.Text;

namespace Aegis.ProtectedSession
{
    // Fixed administrative profile: scripts/installation/protected-guest.ps1.
    // WMI V2 enum values and units: Microsoft Learn msvm-virtualsystemsettingdata,
    // msvm-memorysettingdata and msvm-resourceallocationsettingdata.
    internal static class VmConfigurationProfile
    {
        internal const string Name = "aegis-offline-fixed-v1";
        private const string Prefix = "Microsoft:Hyper-V:";

        internal static T Value<T>(Dictionary<string, object> values, string key)
        {
            object value;
            if (values == null || !values.TryGetValue(key, out value) || !(value is T)) Refuse();
            return (T)values[key];
        }

        internal static string Text(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 2048 || value.IndexOf('\0') >= 0) Refuse();
            return value;
        }

        internal static string Endpoint(string value, string name)
        {
            try { return VmManagementNative.ValidatePath(Text(value), name).RelativePath.ToLowerInvariant(); }
            catch (ArgumentException) { Refuse(); }
            catch (ManagementException) { Refuse(); }
            return null;
        }

        private static string HostPath(string value)
        {
            value = Text(value);
            // Refuse streams/device/UNC/relative paths before invoking the inbox
            // parser, whose expected malformed-input exceptions vary by runtime.
            if (value.Length < 4 || !((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) ||
                value[1] != ':' || value[2] != '\\' || value.IndexOf(':', 2) >= 0 ||
                value.IndexOfAny(System.IO.Path.GetInvalidPathChars()) >= 0 || value.IndexOfAny(new[] { '*', '?', '/' }) >= 0) Refuse();
            try { if (System.IO.Path.GetFullPath(value) != value) Refuse(); }
            catch (ArgumentException) { Refuse(); }
            catch (NotSupportedException) { Refuse(); }
            catch (PathTooLongException) { Refuse(); }
            return value;
        }

        private static void Refuse() { throw new InvalidOperationException("installed-vm-configuration-unavailable"); }
        private static void Field(StringBuilder output, string value)
        { value = Text(value); output.Append(value.Length.ToString(CultureInfo.InvariantCulture)).Append(':').Append(value); }
        private static void Require<T>(Dictionary<string, object> values, string key, T expected)
        { if (!EqualityComparer<T>.Default.Equals(Value<T>(values, key), expected)) Refuse(); }
        private static string Slot(string value)
        {
            uint slot;
            if (!UInt32.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out slot) ||
                slot > 63 || slot.ToString(CultureInfo.InvariantCulture) != value) Refuse();
            return value;
        }

        internal static VmConfigurationObservation Validate(VmConfigurationData data, Guid id, string identity)
        {
            if (data == null || id == Guid.Empty || data.VmId != id || data.Identity != identity) Refuse();
            Text(identity);
            var settings = data.Settings;
            Require(settings, "VirtualSystemIdentifier", id.ToString("D"));
            Require(settings, "VirtualSystemType", Prefix + "System:Realized");
            Require(settings, "VirtualSystemSubType", Prefix + "SubType:2");
            Require(settings, "AutomaticStartupAction", (ushort)2);
            Require(settings, "AutomaticShutdownAction", (ushort)2);
            Require(settings, "AutomaticSnapshotsEnabled", false);
            Require(settings, "UserSnapshotType", (ushort)2);
            Require(settings, "SecureBootEnabled", true);
            string settingsId = Text(Value<string>(settings, "InstanceID"));
            if (!identity.EndsWith("\n" + settingsId, StringComparison.Ordinal)) Refuse();
            if (data.Resources.Count < 5 || data.Resources.Count > 256) Refuse();
            var paths = new Dictionary<string, VmConfigurationResource>(StringComparer.Ordinal);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var controllerSlots = new HashSet<string>(StringComparer.Ordinal);
            var hostPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            VmConfigurationResource disk = null, dvd = null, diskFile = null, dvdFile = null;
            int memory = 0, cpu = 0, controllers = 0;
            var output = new StringBuilder(Name + ":gen=2;memoryMiB=4096;dynamic=false;cpu=2;autoStart=2;autoStop=2;autoSnapshots=false;snapshotType=2;secureBoot=true;snapshots=0;nics=0:");
            Field(output, id.ToString("D")); Field(output, identity);
            Field(output, Endpoint(data.SettingsPath, "Msvm_VirtualSystemSettingData"));
            // Validate the complete set before digesting any arbitrary provider material.
            foreach (var row in data.Resources)
            {
                if (row == null || row.Values == null) Refuse();
                string path = Endpoint(row.Path, row.ClassName);
                if (paths.ContainsKey(path) || !ids.Add(Text(Value<string>(row.Values, "InstanceID")))) Refuse();
                paths.Add(path, row);
                ushort type = Value<ushort>(row.Values, "ResourceType");
                string subtype = Text(Value<string>(row.Values, "ResourceSubType"));
                if (row.ClassName == "Msvm_MemorySettingData")
                {
                    if (++memory != 1 || type != 4 || subtype != Prefix + "Memory") Refuse();
                    Require(row.Values, "DynamicMemoryEnabled", false);
                    Require(row.Values, "VirtualQuantity", (ulong)4096);
                    Require(row.Values, "VirtualQuantityUnits", "byte * 2^20");
                }
                else if (row.ClassName == "Msvm_ProcessorSettingData")
                {
                    if (++cpu != 1 || type != 3 || subtype != Prefix + "Processor") Refuse();
                    Require(row.Values, "VirtualQuantity", (ulong)2);
                }
                else if (row.ClassName == "Msvm_StorageAllocationSettingData")
                {
                    if (type != 31) Refuse();
                    if (subtype == Prefix + "Virtual Hard Disk" && diskFile == null) diskFile = row;
                    else if (subtype == Prefix + "Virtual CD/DVD Disk" && dvdFile == null) dvdFile = row;
                    else Refuse();
                    string[] host = Value<string[]>(row.Values, "HostResource");
                    if (host.Length != 1 || !hostPaths.Add(HostPath(host[0]))) Refuse();
                }
                else if (row.ClassName == "Msvm_ResourceAllocationSettingData")
                {
                    if (type == 6 && subtype == Prefix + "Synthetic SCSI Controller")
                    {
                        string address = Slot(Value<string>(row.Values, "Address"));
                        if (++controllers > 4 || address.Length != 1 || address[0] > '3' || !controllerSlots.Add(address)) Refuse();
                    }
                    else if (type == 17 && subtype == Prefix + "Synthetic Disk Drive" && disk == null) disk = row;
                    else if (type == 16 && subtype == Prefix + "Synthetic DVD Drive" && dvd == null) dvd = row;
                    else if (!Benign(type, subtype)) Refuse();
                }
                else Refuse(); // Includes synthetic/emulated NICs and unknown resource classes.
            }
            if (memory != 1 || cpu != 1 || controllers == 0 || disk == null || dvd == null || diskFile == null || dvdFile == null) Refuse();
            string diskSlot = Attachment(paths, disk, diskFile, true);
            string dvdSlot = Attachment(paths, dvd, dvdFile, false);
            if (diskSlot == dvdSlot) Refuse();
            var ordered = new List<string>(paths.Keys); ordered.Sort(StringComparer.Ordinal);
            foreach (string key in ordered)
            {
                var row = paths[key]; Field(output, key);
                Field(output, Value<string>(row.Values, "InstanceID"));
                Field(output, Value<string>(row.Values, "ResourceSubType"));
                Field(output, Value<ushort>(row.Values, "ResourceType").ToString(CultureInfo.InvariantCulture));
                if (row.ClassName == "Msvm_ResourceAllocationSettingData")
                {
                    ushort type = Value<ushort>(row.Values, "ResourceType");
                    if (type == 6) Field(output, Value<string>(row.Values, "Address"));
                    if (row == disk || row == dvd)
                    { Field(output, Endpoint(Value<string>(row.Values, "Parent"), "Msvm_ResourceAllocationSettingData")); Field(output, Value<string>(row.Values, "AddressOnParent")); }
                }
                if (row.ClassName == "Msvm_StorageAllocationSettingData")
                { Field(output, Endpoint(Value<string>(row.Values, "Parent"), "Msvm_ResourceAllocationSettingData")); Field(output, Value<string[]>(row.Values, "HostResource")[0].ToLowerInvariant()); }
            }
            string digest;
            using (var sha = SHA256.Create())
                digest = BitConverter.ToString(sha.ComputeHash(new UTF8Encoding(false, true).GetBytes(output.ToString()))).Replace("-", "").ToLowerInvariant();
            return new VmConfigurationObservation(id, identity, Name, digest);
        }

        private static bool Benign(ushort type, string subtype)
        {
            return (type == 1 && (subtype == Prefix + "Synthetic Mouse" || subtype == Prefix + "Synthetic Keyboard")) ||
                (type == 24 && subtype == Prefix + "Synthetic Display Controller");
        }

        private static string Attachment(Dictionary<string, VmConfigurationResource> paths,
            VmConfigurationResource drive, VmConfigurationResource file, bool disk)
        {
            string drivePath = Endpoint(drive.Path, "Msvm_ResourceAllocationSettingData");
            if (Endpoint(Value<string>(file.Values, "Parent"), "Msvm_ResourceAllocationSettingData") != drivePath) Refuse();
            string parent = Endpoint(Value<string>(drive.Values, "Parent"), "Msvm_ResourceAllocationSettingData");
            VmConfigurationResource controller;
            if (!paths.TryGetValue(parent, out controller) || Value<ushort>(controller.Values, "ResourceType") != 6 ||
                Value<string>(controller.Values, "ResourceSubType") != Prefix + "Synthetic SCSI Controller") Refuse();
            string slot = Slot(Value<string>(drive.Values, "AddressOnParent"));
            if (disk && (Value<string>(controller.Values, "Address") != "0" || slot != "0")) Refuse();
            return parent + ":" + slot;
        }
    }
}
