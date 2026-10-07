using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;

// Disposable current-process observations only; no accounts, ACLs or child launch.
public static class CloudGuestTokenFixture
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    private static readonly MethodInfo Open = typeof(CloudGuestProcess).GetMethod("OpenHeldToken", BindingFlags.NonPublic | BindingFlags.Static);

    private static readonly MethodInfo ReceiverOpen = typeof(CloudGuestNetwork).GetMethod("OpenHeldToken", BindingFlags.NonPublic | BindingFlags.Static);
    public static Dictionary<string, object> Observe(bool queryOnly) { return ObserveToken(queryOnly, Open, "actual-launcher-open"); }
    public static Dictionary<string, object> ObserveReceiver() { return ObserveToken(false, ReceiverOpen, "actual-receiver-open"); }
    private static Dictionary<string, object> ObserveToken(bool queryOnly, MethodInfo opener, string path)
    {
        IntPtr token = IntPtr.Zero;
        var result = new Dictionary<string, object>();
        result["path"] = queryOnly ? "query-only" : path;
        result["membershipObserved"] = false; result["administratorEnabled"] = null;
        try
        {
            if (queryOnly)
            {
                if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) throw new InvalidOperationException("fixture-token-open-refused");
            }
            else token = (IntPtr)opener.Invoke(null, new object[] { GetCurrentProcess() });
            using (var identity = new WindowsIdentity(token))
            using (var current = WindowsIdentity.GetCurrent())
            {
                result["sidMatches"] = identity.User.Equals(current.User);
                result["administratorEnabled"] = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                result["baselineAdministratorEnabled"] = new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator);
                result["membershipObserved"] = true;
            }
        }
        catch (System.Security.SecurityException error)
        {
            result["hResult"] = error.HResult; result["win32Error"] = Marshal.GetLastWin32Error();
            // Unavailable membership is never interpreted as a nonadministrator.
            result["administratorEnabled"] = null;
        }
        finally { if (token != IntPtr.Zero && !CloseHandle(token)) throw new InvalidOperationException("fixture-token-close-refused"); }
        return result;
    }
    public static bool RefusesInvalid(bool closed) { return RefusesInvalidToken(closed, Open); }
    public static bool RefusesInvalidReceiver(bool closed) { return RefusesInvalidToken(closed, ReceiverOpen); }
    private static bool RefusesInvalidToken(bool closed, MethodInfo opener)
    {
        IntPtr held = IntPtr.Zero;
        if (closed)
        {
            if (!DuplicateHandle(GetCurrentProcess(), GetCurrentProcess(), GetCurrentProcess(), out held, 0, false, 2) ||
                !CloseHandle(held)) throw new InvalidOperationException("fixture-process-close-refused");
        }
        try
        {
            IntPtr token = (IntPtr)opener.Invoke(null, new object[] { held });
            if (!CloseHandle(token)) throw new InvalidOperationException("fixture-unexpected-token-close-refused");
            return false;
        }
        catch (TargetInvocationException error) { return error.InnerException is InvalidOperationException; }
    }
}
