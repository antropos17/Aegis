using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// Read-only held instance: reopening an elevated PID with Process.SafeHandle can
// request all-access. This handle has neither terminate nor memory-write rights.
internal sealed class ObservedProcess : IDisposable
{
    internal const uint Rights = 0x00101000; // SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
    private readonly SafeProcessHandle handle;
    internal PeerIdentity Identity { get; }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(SafeProcessHandle handle, out uint code);

    internal ObservedProcess(int pid)
    {
        handle = OpenProcess(Rights, false, pid);
        try
        {
            if (handle.IsInvalid) throw new Win32Exception();
            if (HasExited) throw new InvalidOperationException();
            Identity = Security.Observe(handle, pid);
        }
        catch { handle.Dispose(); throw; }
    }

    internal bool HasExited => WaitForSingleObject(handle, 0) switch
    {
        0 => true,
        258 => false,
        _ => throw new Win32Exception()
    };

    internal int? ExitCode
    {
        get
        {
            if (!HasExited) return null;
            if (!GetExitCodeProcess(handle, out uint code)) throw new Win32Exception();
            return unchecked((int)code);
        }
    }

    internal async Task WaitForExit(CancellationToken token)
    {
        while (!HasExited) await Task.Delay(50, token);
    }

    public void Dispose() => handle.Dispose();
}
