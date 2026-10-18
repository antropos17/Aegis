using System.Diagnostics;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// A normal-token test witness retains read-only original objects before faults.
// It neither persists cleanup authority nor grants a replacement controller any.
internal sealed class FileOriginalObservation : IDisposable
{
    private readonly List<SafeProcessHandle> originals = [];
    internal FileOriginalObservation(int[] pids)
    {
        var self = Security.Current();
        try
        {
            for (int i = 0; i < pids.Length; i++)
            {
                var handle = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, pids[i]);
                originals.Add(handle);
                var peer = Security.Observe(handle, pids[i]);
                if (FileMainHandles.Gone(handle) || peer.User != self.User || peer.Logon != self.Logon ||
                    peer.Elevated != (i >= 2) || !peer.Image.Equals(i == 0 ? FileMainParent.PackagedImage : Program.Executable,
                        StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
            }
        }
        catch { Dispose(); throw; }
    }
    internal async Task<int[]> Wait()
    {
        long start = Stopwatch.GetTimestamp();
        while (!originals.All(FileMainHandles.Gone))
        {
            if (Stopwatch.GetElapsedTime(start) > TimeSpan.FromSeconds(25)) throw new TimeoutException();
            await Task.Delay(50);
        }
        return originals.Select(FileMainHandles.ExitCode).ToArray();
    }
    public void Dispose() { foreach (var handle in originals) handle.Dispose(); }
}
