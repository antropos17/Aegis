using System;
using System.Globalization;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

// Read-only WMI diagnostic. No method invocation, provisioning or VM transitions.
internal static class VmInspectionProbe
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OsVersion
    {
        public uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string ServicePack;
    }
    [DllImport("ntdll.dll", CharSet = CharSet.Unicode)]
    private static extern int RtlGetVersion(ref OsVersion version);

    private static string Failure(Exception error)
    {
        var management = error as ManagementException;
        if (error is UnauthorizedAccessException ||
            (management != null && management.ErrorCode == ManagementStatus.AccessDenied) ||
            error.HResult == unchecked((int)0x80070005)) return "denied";
        return "unavailable";
    }

    private static ManagementObjectCollection Query(string scope, string query)
    {
        using (var search = new ManagementObjectSearcher(scope, query))
        {
            search.Options.Timeout = TimeSpan.FromSeconds(3);
            return search.Get();
        }
    }

    private static string Hash(string value)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
    }

    private static int Main(string[] args)
    {
        Guid selected;
        if (args.Length > 1 || (args.Length == 1 &&
            (!Guid.TryParseExact(args[0], "D", out selected) || selected.ToString("D") != args[0]))) return 2;
        var version = new OsVersion(); version.Size = (uint)Marshal.SizeOf(version);
        if (RtlGetVersion(ref version) != 0) return 2;
        string hypervisor = "null", manager = "unavailable", vm = args.Length == 0 ? "not-selected" : "unavailable";
        string detail = "null";
        try
        {
            using (var rows = Query(@"root\cimv2", "SELECT HypervisorPresent FROM Win32_ComputerSystem"))
                foreach (ManagementObject row in rows)
                using (row) { hypervisor = Convert.ToBoolean(row["HypervisorPresent"]) ? "true" : "false"; }
        }
        catch { /* Unknown is kept as null. */ }
        try
        {
            using (var rows = Query(@"root\virtualization\v2", "SELECT Name FROM Msvm_VirtualSystemManagementService"))
                manager = rows.Count == 1 ? "available" : "unavailable";
        }
        catch (Exception error) { manager = Failure(error); }
        if (args.Length == 1)
        {
            try
            {
                using (var rows = Query(@"root\virtualization\v2", "SELECT Name,EnabledState FROM Msvm_ComputerSystem WHERE Name='" + args[0] + "'"))
                {
                    if (rows.Count == 0) vm = "missing";
                    else if (rows.Count == 1)
                    foreach (ManagementObject row in rows)
                    using (row)
                    {
                        ushort enabled = Convert.ToUInt16(row["EnabledState"]);
                        string state = enabled == 2 ? "running" : enabled == 3 ? "off" : "other";
                        using (var settings = row.GetRelated("Msvm_VirtualSystemSettingData"))
                        {
                            int realized = 0;
                            foreach (ManagementObject setting in settings)
                            using (setting)
                            {
                                if ((string)setting["VirtualSystemType"] != "Microsoft:Hyper-V:System:Realized") continue;
                                realized++;
                                if ((string)setting["VirtualSystemIdentifier"] != args[0]) throw new InvalidOperationException();
                                string subtype = (string)setting["VirtualSystemSubType"];
                                int generation = subtype == "Microsoft:Hyper-V:SubType:2" ? 2 : subtype == "Microsoft:Hyper-V:SubType:1" ? 1 : 0;
                                if (generation == 0 || !(setting["SecureBootEnabled"] is bool)) throw new InvalidOperationException();
                                bool secureBoot = Convert.ToBoolean(setting["SecureBootEnabled"]);
                                int count;
                                using (var ports = setting.GetRelated("Msvm_SyntheticEthernetPortSettingData")) count = ports.Count;
                                if (count > 256) throw new InvalidOperationException();
                                string subset = generation + ":" + secureBoot + ":" + count;
                                detail = "{\"state\":\"" + state + "\",\"generation\":" + generation +
                                    ",\"secureBoot\":" + (secureBoot ? "true" : "false") +
                                    ",\"syntheticNicCount\":" + count + ",\"configSubsetSha256\":\"" + Hash(subset) + "\"}";
                            }
                            if (realized != 1) throw new InvalidOperationException();
                        }
                        vm = "observed";
                    }
                    else throw new InvalidOperationException();
                }
            }
            catch (Exception error) { vm = Failure(error); detail = "null"; }
        }
        Console.WriteLine("{\"version\":1,\"scope\":\"read-only-hyper-v-subset\",\"osBuild\":" +
            version.Build.ToString(CultureInfo.InvariantCulture) + ",\"hypervisorPresent\":" + hypervisor +
            ",\"managerStatus\":\"" + manager + "\",\"vmStatus\":\"" + vm + "\",\"details\":" + detail + "}");
        return 0;
    }
}
