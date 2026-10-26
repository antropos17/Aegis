using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Read-only x64 native Claude launch evidence. The process handle pins its
// generation while reading PEB strings. No raw command line leaves this helper.
internal static class ClaudeSession {
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr handle, out long birth, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process(IntPtr handle, out bool wow64);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadProcessMemory(IntPtr handle, IntPtr address, byte[] bytes, IntPtr size, out IntPtr read);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr handle, int kind, IntPtr value, int length, out int returned);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CommandLineToArgvW(string text, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private static void Need(bool value) { if (!value) throw new InvalidOperationException(); }
    private static byte[] Read(IntPtr handle, IntPtr address, int length) {
        Need(address.ToInt64() > 0 && length > 0 && length <= 65536);
        byte[] bytes = new byte[length];
        IntPtr read;
        Need(ReadProcessMemory(handle, address, bytes, (IntPtr)length, out read) && read.ToInt64() == length);
        return bytes;
    }
    private static string Text(IntPtr handle, IntPtr parameters, int offset) {
        byte[] descriptor = Read(handle, IntPtr.Add(parameters, offset), 16);
        int length = BitConverter.ToUInt16(descriptor, 0), maximum = BitConverter.ToUInt16(descriptor, 2);
        Need(length > 0 && length <= maximum && length <= 65534 && length % 2 == 0);
        byte[] bytes = Read(handle, (IntPtr)BitConverter.ToInt64(descriptor, 8), length);
        try {
            string text = new UnicodeEncoding(false, false, true).GetString(bytes);
            Need(text.IndexOf('\0') < 0);
            return text;
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    internal static string SelectSession(string[] args) {
        string selected = null;
        for (int i = 1; i < args.Length; i++) {
            string arg = args[i], value = null;
            if (arg == "--") break;
            if (arg == "--session-id" || arg == "--resume" || arg == "-r") {
                if (++i >= args.Length) return null;
                value = args[i];
            } else if (arg.StartsWith("--session-id=", StringComparison.Ordinal)) value = arg.Substring(13);
            else if (arg.StartsWith("--resume=", StringComparison.Ordinal)) value = arg.Substring(9);
            if (value == null) continue;
            Guid id;
            if (selected != null || !Guid.TryParseExact(value, "D", out id)) return null;
            selected = id.ToString("D");
        }
        return selected;
    }
    internal static string Session(string command) {
        int count;
        IntPtr values = CommandLineToArgvW(command, out count);
        Need(values != IntPtr.Zero && count > 0 && count <= 256);
        try {
            string[] args = new string[count];
            for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, i * IntPtr.Size));
            return SelectSession(args);
        } finally { LocalFree(values); }
    }
    private static IntPtr Parameters(IntPtr handle) {
        bool wow64;
        Need(IntPtr.Size == 8 && IsWow64Process(handle, out wow64) && !wow64);
        IntPtr basic = Marshal.AllocHGlobal(48);
        IntPtr peb;
        try {
            int returned;
            Need(NtQueryInformationProcess(handle, 0, basic, 48, out returned) == 0 && returned == 48);
            peb = Marshal.ReadIntPtr(basic, 8);
        } finally { Marshal.FreeHGlobal(basic); }
        return (IntPtr)BitConverter.ToInt64(Read(handle, IntPtr.Add(peb, 0x20), 8), 0);
    }
    internal static object ObserveCwd(uint pid) {
        IntPtr handle = OpenProcess(0x00101410, false, pid);
        if (handle == IntPtr.Zero) return null;
        try {
            long birth = 0, exit = 0, kernel = 0, user = 0;
            Need(WaitForSingleObject(handle, 0) == 258 && GetProcessTimes(handle, out birth, out exit, out kernel, out user) && birth > 0);
            string cwd = Text(handle, Parameters(handle), 0x38);
            Need(cwd.Length <= 4096 && Path.IsPathRooted(cwd) && WaitForSingleObject(handle, 0) == 258);
            return new { ProcessId = pid, Cwd = cwd, CreateTime100ns = birth.ToString(CultureInfo.InvariantCulture) };
        } catch { return null; }
        finally { CloseHandle(handle); }
    }
    private static object Observe(uint pid) {
        // Query, read and synchronize only. No intervention, injection or writes.
        IntPtr handle = OpenProcess(0x00101410, false, pid);
        if (handle == IntPtr.Zero) return null;
        try {
            bool wow64;
            long birth = 0, exit = 0, kernel = 0, user = 0;
            Need(IntPtr.Size == 8 && IsWow64Process(handle, out wow64) && !wow64);
            Need(WaitForSingleObject(handle, 0) == 258 && GetProcessTimes(handle, out birth, out exit, out kernel, out user) && birth > 0);
            StringBuilder image = new StringBuilder(32768);
            int size = image.Capacity;
            Need(QueryFullProcessImageName(handle, 0, image, ref size));
            Need(String.Equals(Path.GetFileName(image.ToString()), "claude.exe", StringComparison.OrdinalIgnoreCase));
            IntPtr parameters = Parameters(handle);
            string cwd = Text(handle, parameters, 0x38);
            string session = Session(Text(handle, parameters, 0x70));
            Need(cwd.Length <= 4096 && Path.IsPathRooted(cwd) && WaitForSingleObject(handle, 0) == 258);
            return new { ProcessId = pid, CreateTime100ns = birth.ToString(CultureInfo.InvariantCulture), Cwd = cwd, SessionId = session };
        } catch { return null; }
        finally { CloseHandle(handle); }
    }
    internal static object Query(Dictionary<string, object> request) {
        ArrayList input = request.ContainsKey("pids") ? request["pids"] as ArrayList : null;
        Need(request.Count == 1 && input != null && input.Count > 0 && input.Count <= 32);
        HashSet<uint> seen = new HashSet<uint>();
        List<object> rows = new List<object>();
        foreach (object value in input) {
            uint pid;
            Need((value is int || value is long) && UInt32.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out pid) && pid > 0);
            pid = Convert.ToUInt32(value, CultureInfo.InvariantCulture);
            Need(seen.Add(pid));
        }
        // A cached app population alone cannot exclude a second native Claude.
        // Observe the actual OS population on each side of the transcript read.
        HashSet<uint> live = new HashSet<uint>();
        foreach (Process process in Process.GetProcessesByName("claude")) {
            using (process) { live.Add((uint)process.Id); }
            Need(live.Count <= 32);
        }
        if (!live.SetEquals(seen)) return rows;
        foreach (uint pid in seen) {
            object row = Observe(pid);
            if (row != null) rows.Add(row);
        }
        return rows;
    }
}
