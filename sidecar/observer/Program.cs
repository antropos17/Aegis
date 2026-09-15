using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Management;
using System.Text;
using System.Web.Script.Serialization;

// One read-only observation per process. Inputs use stdin, never command arguments
// or disk. No credentials/file contents are opened, and errors print no OS detail.
public static class ObserverProgram {
    private const int Limit = 524288;
    public static int Main(string[] args) {
        if (args.Length != 1 || (args[0] != "tcp" && args[0] != "cwd" && args[0] != "holders")) return 2;
        try {
            Console.InputEncoding = new UTF8Encoding(false, true);
            Console.OutputEncoding = new UTF8Encoding(false);
            StringBuilder input = new StringBuilder();
            char[] buffer = new char[4096];
            int count;
            while ((count = Console.In.Read(buffer, 0, buffer.Length)) > 0) {
                if (input.Length + count > Limit) return 2;
                input.Append(buffer, 0, count);
            }
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = 2097152;
            json.RecursionLimit = 12;
            Dictionary<string, object> request = json.Deserialize<Dictionary<string, object>>(input.ToString());
            object rows = args[0] == "holders" ? Holders(request) : Query(args[0], request);
            string output = json.Serialize(new { version = 1, rows = rows });
            if (Encoding.UTF8.GetByteCount(output) > 2097152) return 1;
            Console.WriteLine(output);
            return 0;
        } catch { return 1; }
    }

    private static uint Pid(object value) {
        if (!(value is int) && !(value is long) && !(value is decimal)) throw new ArgumentException();
        string text = Convert.ToString(value, CultureInfo.InvariantCulture);
        uint pid;
        if (!UInt32.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid == 0)
            throw new ArgumentException();
        return pid;
    }

    private static object Query(string mode, Dictionary<string, object> request) {
        ArrayList values = request["pids"] as ArrayList;
        if (values == null || values.Count == 0 || values.Count > 2048) throw new ArgumentException();
        string owner = mode == "tcp" ? "OwningProcess" : "ProcessId";
        HashSet<uint> wanted = new HashSet<uint>();
        List<string> filters = new List<string>();
        foreach (object value in values) {
            uint pid = Pid(value);
            if (wanted.Add(pid)) filters.Add(owner + "=" + pid.ToString(CultureInfo.InvariantCulture));
        }
        string[] fields = mode == "tcp"
            ? new string[] { "OwningProcess", "RemoteAddress", "RemotePort", "LocalAddress", "LocalPort", "State" }
            : new string[] { "ProcessId", "CommandLine" };
        string scope = mode == "tcp" ? "root\\StandardCimv2" : "root\\cimv2";
        string table = mode == "tcp" ? "MSFT_NetTCPConnection" : "Win32_Process";
        string query = "SELECT " + String.Join(",", fields) + " FROM " + table + " WHERE " + String.Join(" OR ", filters.ToArray());
        EnumerationOptions options = new EnumerationOptions();
        options.Timeout = TimeSpan.FromSeconds(4);
        options.Rewindable = false;
        List<object> result = new List<object>();
        using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(scope, query, options))
        using (ManagementObjectCollection rows = searcher.Get()) {
            foreach (ManagementObject row in rows) {
                using (row) {
                    if (!wanted.Contains(Convert.ToUInt32(row[owner], CultureInfo.InvariantCulture))) throw new InvalidOperationException();
                    if (mode == "tcp") {
                        int state = Convert.ToInt32(row["State"], CultureInfo.InvariantCulture);
                        string remote = row["RemoteAddress"] as string;
                        // Same literal exclusions as windows-tcp.js and the previous cmdlet.
                        if (state == 2 || state == 100 || remote == "0.0.0.0" || remote == "::" || remote == "127.0.0.1" || remote == "::1") continue;
                    }
                    Dictionary<string, object> item = new Dictionary<string, object>();
                    foreach (string field in fields) item[field] = row[field];
                    result.Add(item);
                    if (result.Count > 16384) throw new InvalidOperationException();
                }
            }
        }
        return result;
    }

    private static object Holders(Dictionary<string, object> request) {
        ArrayList groups = request["groups"] as ArrayList;
        if (groups == null || groups.Count > 2048) throw new ArgumentException();
        List<object> rows = new List<object>();
        for (int index = 0; index < groups.Count; index++) {
            ArrayList files = groups[index] as ArrayList;
            if (files == null || files.Count == 0 || files.Count > 64) throw new ArgumentException();
            string[] paths = new string[files.Count];
            for (int i = 0; i < files.Count; i++) {
                string file = files[i] as string;
                if (String.IsNullOrEmpty(file) || file.Length > 32767 || file.IndexOf('\0') >= 0) throw new ArgumentException();
                paths[i] = file;
            }
            // The SAME RM wrapper used by the PowerShell fallback is compiled in
            // by build-sidecar.js. Sessions remain sequential and close in finally.
            rows.Add(new { index = index, pids = AegisRm.GetHolders(paths) });
        }
        return rows;
    }
}
