using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Fixed controlled workload, not an AI provider. Only task-owned paths supplied
// by the parent are used. It performs useful CSV aggregation for both task kinds.
internal static class NativeTaskWorker {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    public static int Main(string[] args) {
        if (args.Length != 5 || args[3] != "--cwd") return 2;
        try {
            string input = Path.GetFullPath(args[0]), project = Path.GetFullPath(args[1]), outside = Path.GetFullPath(args[2]);
            if (Path.GetFullPath(args[4]) != project || project == outside || !Directory.Exists(project) || !Directory.Exists(outside)) return 2;
            using (Process own = Process.GetCurrentProcess()) {
                Emit(new { kind = "ready", version = "native-csv-worker/1", pid = own.Id,
                    birthTicks = own.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture) });
                string task;
                while ((task = Console.ReadLine()) != null) {
                    if (task == "stop") return 0;
                    if (task != "ordinary" && task != "outside-write") return 2;
                    own.Refresh();
                    long cpuBefore = own.TotalProcessorTime.Ticks;
                    Stopwatch clock = Stopwatch.StartNew();
                    long rows = 0, sum = 0;
                    using (StreamReader reader = new StreamReader(input, new UTF8Encoding(false, true))) {
                        string line;
                        while ((line = reader.ReadLine()) != null) {
                            string[] columns = line.Split(',');
                            if (columns.Length != 2 || Int64.Parse(columns[0], CultureInfo.InvariantCulture) != rows) return 3;
                            sum += Int64.Parse(columns[1], CultureInfo.InvariantCulture); rows++;
                        }
                    }
                    string output = "rows=" + rows.ToString(CultureInfo.InvariantCulture) + "\nsum=" + sum.ToString(CultureInfo.InvariantCulture) + "\n";
                    string destination = task == "ordinary" ? Path.Combine(project, "ordinary-summary.txt") : Path.Combine(outside, "controlled-summary.txt");
                    using (FileStream stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
                        byte[] bytes = new UTF8Encoding(false).GetBytes(output); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
                    }
                    clock.Stop(); own.Refresh();
                    Emit(new { kind = "result", task = task, completed = true, rows = rows, sum = sum,
                        elapsedTicks = clock.ElapsedTicks.ToString(CultureInfo.InvariantCulture),
                        clockFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture),
                        cpuTicks = (own.TotalProcessorTime.Ticks - cpuBefore).ToString(CultureInfo.InvariantCulture),
                        workingSetBytes = own.WorkingSet64.ToString(CultureInfo.InvariantCulture) });
                }
            }
            return 2;
        } catch { Emit(new { kind = "failed", code = "native-task-failed" }); return 1; }
    }
}
