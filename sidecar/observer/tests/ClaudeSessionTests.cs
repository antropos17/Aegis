using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Globalization;

internal static class ClaudeSessionTests {
    private static int passed;
    private static void Check(bool value) { if (!value) throw new Exception("session-evidence-control-failed:" + (passed + 1)); passed++; }
    public static int Main(string[] args) {
        if (args.Length > 0 && args[0] == "--fixture-wait") { System.Threading.Thread.Sleep(15000); return 0; }
        const string id = "12345678-1234-4234-9234-123456789abc";
        Check(ClaudeSession.Session("\"C:\\Program Files\\Claude\\claude.exe\" --session-id " + id + " -p \"read a file\"") == id);
        Check(ClaudeSession.Session("claude.exe --resume=" + id) == id);
        Check(ClaudeSession.Session("claude.exe -r " + id) == id);
        Check(ClaudeSession.Session("claude.exe -p \"literal --session-id " + id + " text\"") == null);
        Check(ClaudeSession.Session("claude.exe -- --session-id " + id) == null);
        Check(ClaudeSession.Session("claude.exe --session-id " + id + " --resume " + id) == null);
        Check(ClaudeSession.Session("claude.exe --session-id invalid") == null);
        Check(ClaudeSession.Session("claude.exe --resume") == null);
        List<object> rows = (List<object>)ClaudeSession.Query(new Dictionary<string, object> { { "pids", new ArrayList { Process.GetCurrentProcess().Id } } });
        Check(rows.Count == 0); // A real non-Claude process is not session evidence.
        string parent = Environment.GetEnvironmentVariable("AEGIS_CLAUDE_CONTROL_ROOT") ?? Path.GetTempPath();
        string scratch = Path.GetFullPath(Path.Combine(parent, "aegis-claude-session-" + Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(scratch);
        string executable = Path.Combine(scratch, "claude.exe");
        File.Copy(Process.GetCurrentProcess().MainModule.FileName, executable);
        Process first = null, second = null;
        try {
            ProcessStartInfo start = new ProcessStartInfo(executable, "--fixture-wait --session-id " + id);
            start.UseShellExecute = false; start.CreateNoWindow = true; start.WorkingDirectory = scratch;
            first = Process.Start(start); second = Process.Start(start);
            rows = (List<object>)ClaudeSession.Query(new Dictionary<string, object> { { "pids", new ArrayList { first.Id } } });
            Check(rows.Count == 0); // A stale population must not omit the second live process.
            rows = (List<object>)ClaudeSession.Query(new Dictionary<string, object> { { "pids", new ArrayList { first.Id, second.Id } } });
            Check(rows.Count == 2);
            foreach (object row in rows) {
                Type type = row.GetType();
                uint pid = (uint)type.GetProperty("ProcessId").GetValue(row, null);
                Process owned = pid == first.Id ? first : second;
                Check((string)type.GetProperty("SessionId").GetValue(row, null) == id &&
                    ((string)type.GetProperty("Cwd").GetValue(row, null)).TrimEnd('\\') == scratch &&
                    (string)type.GetProperty("CreateTime100ns").GetValue(row, null) == owned.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture));
            }
        } finally {
            foreach (Process owned in new Process[] { first, second }) if (owned != null) {
                try { if (!owned.HasExited) { owned.Kill(); owned.WaitForExit(5000); } } finally { owned.Dispose(); }
            }
        }
        Console.WriteLine("Claude session native controls PASS: " + passed);
        return 0;
    }
}
