using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// A normal broker must not request ALL_ACCESS to an elevated grandchild. Retain
// query-limited + synchronize rights on the verified original object instead.
internal sealed class FileGuardPeer : IDisposable
{
    [DllImport("kernel32.dll")] private static extern SafeProcessHandle OpenProcess(uint rights, bool inherit, int pid);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(SafeProcessHandle process, uint timeout);
    [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(SafeProcessHandle process, out uint code);
    private readonly SafeProcessHandle process;
    private readonly int pid;
    internal FileGuardPeer(int id)
    {
        pid = id; process = OpenProcess(0x101000, false, id);
        if (process.IsInvalid) { process.Dispose(); throw new UnauthorizedAccessException(); }
    }
    internal bool HasExited => WaitForSingleObject(process, 0) == 0;
    internal int ExitCode => HasExited && GetExitCodeProcess(process, out uint code) ? unchecked((int)code) : throw new IOException();
    internal void Verify(PipeStream pipe, ulong birth)
    {
        if (HasExited) throw new UnauthorizedAccessException();
        Security.Verify(pipe, process, pid, birth, true, true);
    }
    internal async Task WaitForExitAsync(TimeSpan timeout)
    {
        long from = Stopwatch.GetTimestamp();
        while (!HasExited)
        {
            if (Stopwatch.GetElapsedTime(from) >= timeout) throw new TimeoutException();
            await Task.Delay(50);
        }
    }
    public void Dispose() => process.Dispose();
}
