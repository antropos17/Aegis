using System.Diagnostics;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// Keep the original object returned by ShellExecute or privately deposited by the host.
// A normal controller never reopens an elevated PID with ALL_ACCESS.
internal sealed class FileNativeChild : IDisposable
{
    private readonly Process? shell;
    internal SafeProcessHandle SafeHandle { get; }
    internal int Id { get; }
    internal bool HasExited => FileMainHandles.Gone(SafeHandle);
    internal int ExitCode => FileMainHandles.ExitCode(SafeHandle);
    private FileNativeChild(Process process) { shell = process; Id = process.Id; SafeHandle = process.SafeHandle; }
    internal FileNativeChild(int pid, SafeProcessHandle handle) { Id = pid; SafeHandle = handle; }
    internal static async Task<FileNativeChild> Start(ProcessStartInfo info)
    {
        string? address = Environment.GetEnvironmentVariable(FileQualificationPolicy.Variable);
        if (info.UseShellExecute && address != null) return await FileQualificationClient.Start(info, address);
        return new(Process.Start(info) ?? throw new IOException());
    }
    internal async Task WaitForExitAsync()
    {
        while (!HasExited) await Task.Delay(50);
    }
    public void Dispose() { if (shell != null) shell.Dispose(); else SafeHandle.Dispose(); }
}
