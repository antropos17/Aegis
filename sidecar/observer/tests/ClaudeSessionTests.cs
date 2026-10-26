using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;

internal static class ClaudeSessionTests {
    private static int passed;
    private static void Check(bool value) { if (!value) throw new Exception("session-evidence-control-failed"); passed++; }
    public static int Main() {
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
        Console.WriteLine("Claude session native controls PASS: " + passed);
        return 0;
    }
}
