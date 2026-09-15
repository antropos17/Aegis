using System;
using System.Collections.Generic;
using System.Globalization;
using System.Management;
using System.Text;

// One bounded, read-only query of the SAME formatted counters as the PowerShell
// fallback. No process names, paths, persistent state or raw CPU delta arithmetic.
public static class ResourceProgram {
    public static int Main(string[] args) {
        if (args.Length != 1) return 2;
        string[] values = args[0].Split(',');
        if (values.Length == 0 || values.Length > 2048) return 2;
        HashSet<uint> pids = new HashSet<uint>();
        List<string> predicates = new List<string>();
        foreach (string value in values) {
            uint pid;
            if (!UInt32.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid == 0)
                return 2;
            if (pids.Add(pid)) predicates.Add("IDProcess=" + pid.ToString(CultureInfo.InvariantCulture));
        }
        try {
            EnumerationOptions options = new EnumerationOptions();
            options.Timeout = TimeSpan.FromSeconds(4);
            options.Rewindable = false;
            string query = "SELECT IDProcess,PercentProcessorTime,WorkingSet FROM Win32_PerfFormattedData_PerfProc_Process WHERE "
                + String.Join(" OR ", predicates.ToArray());
            StringBuilder output = new StringBuilder("{\"version\":1,\"rows\":[");
            bool first = true;
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\cimv2", query, options))
            using (ManagementObjectCollection rows = searcher.Get()) {
                foreach (ManagementObject row in rows) {
                    using (row) {
                        if (!first) output.Append(',');
                        first = false;
                        output.Append("{\"IDProcess\":").Append(Number(row["IDProcess"]))
                            .Append(",\"PercentProcessorTime\":").Append(Number(row["PercentProcessorTime"]))
                            .Append(",\"WorkingSet\":").Append(Number(row["WorkingSet"]))
                            .Append('}');
                    }
                }
            }
            Console.WriteLine(output.Append("]}").ToString());
            return 0;
        } catch {
            // The parent selects fallback. Never emit OS exception details.
            return 1;
        }
    }

    private static string Number(object value) {
        if (value == null) return "null";
        ulong number;
        return UInt64.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture),
            NumberStyles.None, CultureInfo.InvariantCulture, out number)
            ? number.ToString(CultureInfo.InvariantCulture) : "null";
    }
}
