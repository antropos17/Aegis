using System;
using System.Collections.Generic;
using System.Management;
using Aegis.ProtectedSession;

// Read-only first-boot diagnostics. No host display, guest log, disk mount or OCR.
internal static class CloudGuestBootDiagnostics
{
    internal const ushort Width = 320, Height = 240;
    internal static bool WindowAllowed(bool closed, long elapsed, int count, long limit, int cap)
    { return !closed && elapsed >= 0 && elapsed < limit && count < cap; }
    internal static bool SettingsIdentity(string id, string type, string observed)
    { return type == "Microsoft:Hyper-V:System:Realized" && String.Equals(id, observed, StringComparison.OrdinalIgnoreCase); }
    internal static ushort ObserveVm(Dictionary<string, object> evidence, string id, string creationClass, string name, object rawState)
    {
        Guid observed;
        evidence["observedVmId"] = Guid.TryParseExact(name, "D", out observed) ? observed.ToString("D") : null;
        bool matched = creationClass == "Msvm_ComputerSystem" && String.Equals(id, name, StringComparison.OrdinalIgnoreCase);
        evidence["vmIdentityMatched"] = matched;
        ushort state = VmManagementNative.UInt16Value(rawState); evidence["enabledState"] = state;
        if (!matched) throw new InvalidOperationException("boot-owned-vm-mismatch");
        return state;
    }
    internal static void ImageMetadata(Dictionary<string, object> evidence, object raw)
    {
        // Fixed categories only. Never stringify unexpected provider objects.
        var bytes = raw as byte[]; var array = raw as Array;
        evidence["imageDataType"] = raw == null ? "null" : bytes != null ? "byte-array" : array != null ? "other-array" : "other";
        evidence["imageDataLength"] = array == null ? null : (object)array.LongLength;
        evidence["imageArrayRank"] = array == null ? null : (object)array.Rank;
        evidence["expectedImageBytes"] = Width * Height * 2;
    }
    internal static string Pixels(object code, object raw)
    {
        if (VmManagementNative.UInt32Value(code) != 0) throw new InvalidOperationException("boot-thumbnail-return-unconfirmed");
        var bytes = raw as byte[];
        if (bytes == null || bytes.Length != Width * Height * 2) throw new InvalidOperationException("boot-thumbnail-size-invalid");
        return Convert.ToBase64String(bytes);
    }
    internal static Dictionary<string, object> Capture(string id, Func<bool> windowOpen)
    {
        var evidence = new Dictionary<string, object> {
            { "vmId", id }, { "phase", "vm-observe" }, { "enabledState", null }, { "heartbeatStatus", null },
            { "width", Width }, { "height", Height }, { "format", "RGB565" }, { "imageBase64", null },
            { "returnCode", null }, { "failureCode", null }, { "hResult", null }, { "captureBeforeCredentialSession", true },
            { "vmIdentityMatched", false }, { "observedVmId", null }, { "imageDataType", null }, { "imageDataLength", null }, { "imageArrayRank", null }, { "expectedImageBytes", Width * Height * 2 }
        };
        try
        {
            if (!windowOpen()) throw new InvalidOperationException("boot-diagnostic-window-closed");
            var scope = new ManagementScope(@"\\.\root\virtualization\v2", new ConnectionOptions { Timeout = TimeSpan.FromSeconds(3) });
            using (var vm = new ManagementObject(scope, new ManagementPath("Msvm_ComputerSystem.CreationClassName=\"Msvm_ComputerSystem\",Name=\"" + id + "\""), new ObjectGetOptions { Timeout = TimeSpan.FromSeconds(3) }))
            {
                vm.Get(); VmManagementNative.ValidatePath(vm.Path.Path, "Msvm_ComputerSystem");
                ushort state = ObserveVm(evidence, id, vm["CreationClassName"] as string, vm["Name"] as string, vm["EnabledState"]);
                if (state != 2) throw new InvalidOperationException("boot-owned-vm-not-running");
                evidence["phase"] = "realized-settings";
                string settingsPath = null; int matched = 0, total = 0;
                using (var settings = vm.GetRelated("Msvm_VirtualSystemSettingData", "Msvm_SettingsDefineState", null, null, "SettingData", "ManagedElement", false,
                    new EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), ReturnImmediately = true }))
                    foreach (ManagementObject setting in settings)
                    using (setting)
                    {
                        if (++total > 64) throw new InvalidOperationException("boot-settings-identity-invalid");
                        if ((setting["VirtualSystemType"] as string) != "Microsoft:Hyper-V:System:Realized") continue;
                        VmManagementNative.ValidatePath(setting.Path.Path, "Msvm_VirtualSystemSettingData");
                        if (!SettingsIdentity(id, setting["VirtualSystemType"] as string, setting["VirtualSystemIdentifier"] as string)) throw new InvalidOperationException("boot-settings-identity-invalid");
                        settingsPath = setting.Path.Path; matched++;
                    }
                if (matched != 1) throw new InvalidOperationException("boot-settings-identity-invalid");
                // Heartbeat absence/errors remain unknown; they cannot prove installation.
                evidence["phase"] = "heartbeat";
                using (var search = new ManagementObjectSearcher(scope, new ObjectQuery("SELECT * FROM Msvm_HeartbeatComponent WHERE SystemName='" + id + "'"),
                    new EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), ReturnImmediately = true }))
                using (var objects = search.Get())
                {
                    int count = 0;
                    foreach (ManagementObject heartbeat in objects)
                    using (heartbeat)
                    {
                        if (++count > 1) throw new InvalidOperationException("boot-heartbeat-identity-invalid");
                        VmManagementNative.ValidatePath(heartbeat.Path.Path, "Msvm_HeartbeatComponent");
                        if (!String.Equals(heartbeat["SystemName"] as string, id, StringComparison.OrdinalIgnoreCase) ||
                            (heartbeat["CreationClassName"] as string) != "Msvm_HeartbeatComponent" || (heartbeat["SystemCreationClassName"] as string) != "Msvm_ComputerSystem") throw new InvalidOperationException("boot-heartbeat-identity-invalid");
                        var status = heartbeat["OperationalStatus"] as ushort[];
                        if (status == null || status.Length > 8) throw new InvalidOperationException("boot-heartbeat-identity-invalid");
                        evidence["heartbeatStatus"] = status;
                    }
                }
                evidence["phase"] = "thumbnail-service";
                using (var search = new ManagementObjectSearcher(scope, new ObjectQuery("SELECT * FROM Msvm_VirtualSystemManagementService"),
                    new EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), ReturnImmediately = true }))
                using (var objects = search.Get())
                {
                    if (objects.Count != 1) throw new InvalidOperationException("boot-thumbnail-service-unavailable");
                    foreach (ManagementObject service in objects)
                    using (service)
                    {
                        VmManagementNative.ValidatePath(service.Path.Path, "Msvm_VirtualSystemManagementService");
                        service.Options.Timeout = TimeSpan.FromSeconds(3);
                        using (var input = service.GetMethodParameters("GetVirtualSystemThumbnailImage"))
                        {
                            if (!windowOpen()) throw new InvalidOperationException("boot-diagnostic-window-closed");
                            input["TargetSystem"] = settingsPath; input["WidthPixels"] = Width; input["HeightPixels"] = Height;
                            evidence["phase"] = "thumbnail-invoke";
                            using (var result = service.InvokeMethod("GetVirtualSystemThumbnailImage", input, new InvokeMethodOptions { Timeout = TimeSpan.FromSeconds(3) }))
                            {
                                if (result == null) throw new InvalidOperationException("boot-thumbnail-result-missing");
                                evidence["returnCode"] = VmManagementNative.UInt32Value(result["ReturnValue"]);
                                ImageMetadata(evidence, result["ImageData"]);
                                if (!windowOpen()) throw new InvalidOperationException("boot-diagnostic-window-closed");
                                evidence["imageBase64"] = Pixels(result["ReturnValue"], result["ImageData"]);
                                evidence["phase"] = "completed";
                            }
                        }
                    }
                }
            }
        }
        catch (Exception error)
        {
            evidence["hResult"] = error.HResult;
            // Fixed diagnostics only; never provider messages or screen text.
            string[] codes = { "boot-diagnostic-window-closed", "boot-owned-vm-mismatch", "boot-owned-vm-not-running", "boot-settings-identity-invalid", "boot-heartbeat-identity-invalid", "boot-thumbnail-service-unavailable", "boot-thumbnail-result-missing", "boot-thumbnail-return-unconfirmed", "boot-thumbnail-size-invalid" };
            evidence["failureCode"] = Array.IndexOf(codes, error.Message) >= 0 ? error.Message : "boot-diagnostic-read-failed";
        }
        return evidence;
    }
}
