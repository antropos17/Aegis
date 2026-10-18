using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal static class FileRecoveryAccess
{
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { internal IntPtr Sid; internal uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags, uint disabledCount, IntPtr disabled,
        uint deletedCount, IntPtr deleted, uint restrictedCount, ref SidAttributes restricted, out SafeAccessTokenHandle token);

    internal static bool NeedsConsent(FileGuardResult result) => !result.stopped && !result.absent && result.counters?.Status == 5;

    // Fixed diagnostic denial, synchronous only. Restore the original thread
    // token before any await, pipe operation or same-account recovery launch.
    internal static FileGuardResult RestrictedProbe(Func<FileGuardResult> run)
    {
        using var identity = WindowsIdentity.GetCurrent();
        var sid = new SecurityIdentifier("S-1-0-0");
        byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        var memory = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            var restricted = new SidAttributes { Sid = memory };
            if (!CreateRestrictedToken(identity.AccessToken, 1, 0, IntPtr.Zero, 0, IntPtr.Zero, 1, ref restricted, out var token))
                throw new Win32Exception();
            using (token) return WindowsIdentity.RunImpersonated(token, run);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
}
