using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal static class FileGeneration
{
    [DllImport("kernel32.dll")] private static extern SafeProcessHandle OpenProcess(uint rights, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    private static extern bool GetProcessTimes(SafeProcessHandle process,
        out ulong birth, out ulong exit, out ulong kernel, out ulong user);

    // One fresh held-handle observation. Never cached, never stamps an agent and never
    // says the process was the issuer at the earlier ETW timestamp.
    internal static FileObservation Observe(FileObservation value)
    {
        if (value.issuerStatus != "candidate") return value;
        long from = Stopwatch.GetTimestamp();
        using var handle = OpenProcess(0x1000, false, value.headerPid);
        if (handle.IsInvalid || !GetProcessTimes(handle, out ulong birth, out ulong exit, out _, out _) || birth == 0 || exit != 0) return value;
        long to = Stopwatch.GetTimestamp();
        return value with
        {
            generationStatus = "candidate",
            generationWitness = birth.ToString(),
            generationSource = "createTime100ns",
            generationInterval = new { fromQpc = from.ToString(), toQpc = to.ToString() }
        };
    }
}
