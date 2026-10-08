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
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int length, out int returned);
    private static readonly MethodInfo Open = typeof(CloudGuestProcess).GetMethod("OpenHeldToken", BindingFlags.NonPublic | BindingFlags.Static);

    private static readonly MethodInfo ReceiverOpen = typeof(CloudGuestNetwork).GetMethod("OpenHeldToken", BindingFlags.NonPublic | BindingFlags.Static);
    private static readonly MethodInfo Groups = typeof(CloudGuestProcess).GetMethod("HasAnyAdministratorGroup", BindingFlags.NonPublic | BindingFlags.Static);
    private static readonly MethodInfo Decode = typeof(CloudGuestProcess).GetMethod("DecodeAdministratorGroups", BindingFlags.NonPublic | BindingFlags.Static);
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
                if (!queryOnly && opener == Open)
                {
                    var filtered = identity.Groups;
                    if (filtered == null) throw new InvalidOperationException("fixture-query-groups-unavailable");
                    foreach (IdentityReference group in filtered)
                        if (!(group is SecurityIdentifier)) throw new InvalidOperationException("fixture-query-group-shape");
                    result["filteredGroupsAvailable"] = true;
                    result["administratorGroupPresent"] = Groups.Invoke(null, new object[] { token });
                    result["baselineAdministratorGroupPresent"] = UnfilteredBaseline(token);
                    result["membershipObserved"] = true;
                    return result; // Never IsInRole on the QUERY-only launcher token.
                }
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
    private static bool UnfilteredBaseline(IntPtr token)
    {
        IntPtr data = Marshal.AllocHGlobal(65536);
        try {
            int returned;
            if (!GetTokenInformation(token, 2, data, 65536, out returned)) throw new InvalidOperationException("fixture-group-query-refused");
            int count = Marshal.ReadInt32(data), stride = IntPtr.Size == 8 ? 16 : 8;
            if (count < 0 || count > 256 || returned < IntPtr.Size + count * stride) throw new InvalidOperationException("fixture-group-query-shape");
            bool found = false;
            for (int at = 0; at < count; at++)
                if (new SecurityIdentifier(Marshal.ReadIntPtr(data, IntPtr.Size + at * stride)).IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)) found = true;
            return found;
        } finally { Marshal.FreeHGlobal(data); }
    }
    public static int GroupControls()
    {
        for (int mode = 0; mode < 13; mode++)
        {
            IntPtr data = Marshal.AllocHGlobal(128);
            try {
                for (int at = 0; at < 128; at++) Marshal.WriteByte(data, at, 0);
                int offset = IntPtr.Size, stride = IntPtr.Size == 8 ? 16 : 8, length = 128;
                Marshal.WriteInt32(data, mode == 10 ? 2 : 1);
                var sid = new SecurityIdentifier(mode == 0 ? WellKnownSidType.WorldSid : WellKnownSidType.BuiltinAdministratorsSid, null);
                byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); Marshal.Copy(bytes, 0, IntPtr.Add(data, 64), bytes.Length);
                Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, 64));
                Marshal.WriteInt32(data, offset + IntPtr.Size, mode == 2 ? 16 : mode == 3 ? 0 : 4);
                if (mode == 4) Marshal.WriteIntPtr(data, offset, IntPtr.Zero);
                if (mode == 5) Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, 128));
                if (mode == 6) Marshal.WriteByte(data, 64, 2);
                if (mode == 7) Marshal.WriteByte(data, 65, 255);
                if (mode == 8) Marshal.WriteInt32(data, 257);
                if (mode == 9) length = offset + stride - 1;
                if (mode == 10) Marshal.WriteIntPtr(data, offset + stride, IntPtr.Zero); // Valid admin never hides later malformed entry.
                if (mode == 11) { Marshal.WriteInt32(data, 0); length = 4; }
                if (mode == 12) Marshal.WriteIntPtr(data, offset, IntPtr.Add(data, offset));
                bool refused = false, present = false;
                try { present = (bool)Decode.Invoke(null, new object[] { data, length }); }
                catch (TargetInvocationException error) { if (!(error.InnerException is InvalidOperationException)) throw; refused = true; }
                bool expectedRefusal = mode >= 4 && mode != 11;
                if (refused != expectedRefusal || (!refused && present != (mode >= 1 && mode <= 3))) throw new InvalidOperationException("fixture-group-control-refused");
            } finally { Marshal.FreeHGlobal(data); }
        }
        return 13;
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
