using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

// Read-only observer of one run-owned, birth-verified process. No discovery.
internal static class NativeResourceReader {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr process);
    [StructLayout(LayoutKind.Sequential)]
    private struct Counters {
        public uint cb, faults;
        public UIntPtr peakWorkingSet, workingSet, peakPaged, paged, peakNonpaged, nonpaged, pagefile, peakPagefile;
    }
    [DllImport("psapi.dll", SetLastError = true)]
    private static extern bool GetProcessMemoryInfo(IntPtr process, ref Counters counters, uint bytes);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    public static int Main(string[] args) {
        IntPtr handle = IntPtr.Zero;
        try {
            if (args.Length != 2) return 2;
            int pid = Int32.Parse(args[0], CultureInfo.InvariantCulture);
            long expectedBirth = Int64.Parse(args[1], CultureInfo.InvariantCulture);
            handle = OpenProcess(0x0400 | 0x0010, false, pid);
            if (handle == IntPtr.Zero) return 3;
            Emit(new { kind = "ready", version = "win32-owned-resource-reader/1" });
            string command;
            while ((command = Console.ReadLine()) != null) {
                if (command == "stop") return 0;
                if (command != "snapshot") return 2;
                long begin = Stopwatch.GetTimestamp(), birth, exit, kernel, user;
                Counters memory = new Counters();
                memory.cb = (uint)Marshal.SizeOf(typeof(Counters));
                if (!GetProcessTimes(handle, out birth, out exit, out kernel, out user) ||
                    birth != expectedBirth || exit != 0 ||
                    !GetProcessMemoryInfo(handle, ref memory, memory.cb)) return 4;
                long end = Stopwatch.GetTimestamp();
                Emit(new { kind = "snapshot", birthTicks = birth.ToString(CultureInfo.InvariantCulture),
                    userUs = user / 10, kernelUs = kernel / 10,
                    residentBytes = memory.workingSet.ToUInt64(),
                    beforeTicks = begin.ToString(CultureInfo.InvariantCulture),
                    afterTicks = end.ToString(CultureInfo.InvariantCulture),
                    frequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture) });
            }
            return 2;
        } catch { Emit(new { kind = "failed", code = "resource-reader-failed" }); return 1; }
        finally { if (handle != IntPtr.Zero) CloseHandle(handle); }
    }
}
