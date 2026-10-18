using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// A bounded candidate inventory, never identity evidence. Every selected TID is
// independently opened, owner-checked and held by FileGeneration before use.
internal static class FileThreadIds
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Entry
    {
        internal uint Size, Usage, Tid, Pid;
        internal int BasePriority, DeltaPriority;
        internal uint Flags;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool Thread32First(SafeFileHandle snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool Thread32Next(SafeFileHandle snapshot, ref Entry entry);
    internal static IEnumerable<uint> InProcess(uint pid)
    {
        using var snapshot = CreateToolhelp32Snapshot(4, 0); // TH32CS_SNAPTHREAD
        if (snapshot.IsInvalid) return [];
        var entry = new Entry { Size = (uint)Marshal.SizeOf<Entry>() };
        var result = new List<uint>(128);
        bool present = Thread32First(snapshot, ref entry);
        for (int seen = 0; present && seen < 32768 && result.Count < 128; seen++)
        {
            if (entry.Size >= 16 && entry.Pid == pid && entry.Tid is not (0 or uint.MaxValue)) result.Add(entry.Tid);
            entry.Size = (uint)Marshal.SizeOf<Entry>();
            present = Thread32Next(snapshot, ref entry);
        }
        return result;
    }
}
