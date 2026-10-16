using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// Records the elevating installer's observed token relation, not a desktop GUI
// process, originating unelevated caller or completed GUI enrollment.
public sealed class ProtectedGuiIdentity : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] private struct Statistics
    {
        internal Luid Token, Authentication; internal long Expiration;
        internal int Type, Level; internal uint Charged, Available, Groups, Privileges; internal Luid Modified;
    }
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenThreadToken(IntPtr thread, uint access, bool self, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(SafeFileHandle token, int kind, IntPtr bytes, int length, out int returned);
    private SafeFileHandle elevated, limited;
    private Observation originalElevated, originalLimited;
    private bool closed, refused;
    private static InvalidDataException Refused() { return new InvalidDataException("protected-gui-principal-refused"); }
    private static void Need(bool value) { if (!value) throw Refused(); }
    private static string Id(Luid value) { return (((ulong)unchecked((uint)value.High) << 32) | value.Low).ToString("x16"); }
    private sealed class Observation
    {
        internal string Sid, Authentication, Token, Modified, Integrity;
        internal int Session, Type, ElevationType, Elevated, AppContainer, UiAccess;
        internal bool Same(Observation other)
        {
            return other != null && Sid == other.Sid && Authentication == other.Authentication && Token == other.Token &&
                Integrity == other.Integrity && Session == other.Session && Type == other.Type &&
                ElevationType == other.ElevationType && Elevated == other.Elevated && AppContainer == other.AppContainer && UiAccess == other.UiAccess;
        }
    }
    private static T Query<T>(SafeFileHandle token, int kind, Func<IntPtr, int, T> read)
    {
        int length; bool sized = GetTokenInformation(token, kind, IntPtr.Zero, 0, out length);
        Need(!sized && Marshal.GetLastWin32Error() == 122 && length > 0 && length <= 65536);
        IntPtr data = Marshal.AllocHGlobal(length);
        try
        {
            int returned; Need(GetTokenInformation(token, kind, data, length, out returned) && returned > 0 && returned <= length);
            return read(data, returned);
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static int Number(SafeFileHandle token, int kind)
    { return Query(token, kind, delegate(IntPtr data, int count) { Need(count == 4); return Marshal.ReadInt32(data); }); }
    private static string Sid(SafeFileHandle token, int kind)
    { return Query(token, kind, delegate(IntPtr data, int count) { Need(count >= IntPtr.Size); return new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; }); }
    private static Statistics Stats(SafeFileHandle token)
    { return Query(token, 10, delegate(IntPtr data, int count) { Need(count == Marshal.SizeOf(typeof(Statistics))); return (Statistics)Marshal.PtrToStructure(data, typeof(Statistics)); }); }
    private static Observation Observe(SafeFileHandle token)
    {
        Need(token != null && !token.IsClosed && !token.IsInvalid);
        Statistics before = Stats(token);
        var result = new Observation { Sid = Sid(token, 1), Integrity = Sid(token, 25), Authentication = Id(before.Authentication),
            Token = Id(before.Token), Modified = Id(before.Modified), Session = Number(token, 12), Type = Number(token, 8),
            ElevationType = Number(token, 18), Elevated = Number(token, 20), AppContainer = Number(token, 29), UiAccess = Number(token, 26) };
        Statistics after = Stats(token);
        Need(Id(before.Token) == Id(after.Token) && Id(before.Authentication) == Id(after.Authentication) && Id(before.Modified) == Id(after.Modified) &&
            before.Type == after.Type && result.Type == before.Type && before.Groups == after.Groups && before.Privileges == after.Privileges);
        return result;
    }
    private static SafeFileHandle Linked(SafeFileHandle token)
    {
        return Query(token, 19, delegate(IntPtr data, int count)
        {
            Need(count == IntPtr.Size); var linked = new SafeFileHandle(Marshal.ReadIntPtr(data), true);
            Need(!linked.IsInvalid); return linked;
        });
    }
    private static void NoImpersonation()
    {
        SafeFileHandle token; bool opened = OpenThreadToken(GetCurrentThread(), 8, true, out token); int error = Marshal.GetLastWin32Error();
        if (token != null) token.Dispose(); Need(!opened && error == 1008);
    }
    private static void CheckPair(Observation full, Observation medium)
    {
        Need(full != null && medium != null && full.Type == 1 && medium.Type == 1 && full.ElevationType == 2 && full.Elevated == 1 &&
            full.Integrity == "S-1-16-12288" && medium.ElevationType == 3 && medium.Elevated == 0 && medium.Integrity == "S-1-16-8192" &&
            full.Session > 0 && full.Session == medium.Session && full.Sid == medium.Sid &&
            full.Sid != "S-1-5-18" && full.Sid != "S-1-5-7" && full.AppContainer == 0 && medium.AppContainer == 0 && full.UiAccess == 0 && medium.UiAccess == 0);
    }
    private ProtectedGuiIdentity() { }
    public static ProtectedGuiIdentity CaptureInstaller()
    {
        var result = new ProtectedGuiIdentity();
        try
        {
            NoImpersonation(); Need(OpenProcessToken(GetCurrentProcess(), 8, out result.elevated));
            result.originalElevated = Observe(result.elevated); result.limited = Linked(result.elevated); result.originalLimited = Observe(result.limited);
            CheckPair(result.originalElevated, result.originalLimited);
            using (var reciprocal = Linked(result.limited)) Need(result.originalElevated.Same(Observe(reciprocal)));
            result.CheckCurrent(); return result;
        }
        catch { result.Dispose(); throw Refused(); }
    }
    public void CheckCurrent()
    {
        try
        {
            Need(!closed && !refused); NoImpersonation();
#if PROTECTED_GUI_TEST
            if (modelPrincipal) { CheckPair(originalElevated, originalLimited); return; }
#endif
            Need(originalElevated.Same(Observe(elevated)) && originalLimited.Same(Observe(limited)));
            using (SafeFileHandle current = CurrentToken()) Need(originalElevated.Same(Observe(current)));
            using (var linked = Linked(elevated)) Need(originalLimited.Same(Observe(linked)));
            CheckPair(originalElevated, originalLimited); NoImpersonation();
        }
        catch { refused = true; throw Refused(); }
    }
    private static SafeFileHandle CurrentToken()
    { SafeFileHandle token; Need(OpenProcessToken(GetCurrentProcess(), 8, out token)); return token; }
    public string InstallerSid { get { CheckCurrent(); return originalElevated.Sid; } }
    public string InstallerAuthentication { get { CheckCurrent(); return originalElevated.Authentication; } }
    public string InstallerTokenId { get { CheckCurrent(); return originalElevated.Token; } }
    public int InstallerSession { get { CheckCurrent(); return originalElevated.Session; } }
    public string LimitedSid { get { CheckCurrent(); return originalLimited.Sid; } }
    public string LimitedAuthentication { get { CheckCurrent(); return originalLimited.Authentication; } }
    public string LimitedTokenId { get { CheckCurrent(); return originalLimited.Token; } }
    public int LimitedSession { get { CheckCurrent(); return originalLimited.Session; } }
    public void Dispose()
    { if (closed) return; closed = true; try { if (limited != null) limited.Dispose(); } finally { if (elevated != null) elevated.Dispose(); } }
#if PROTECTED_GUI_TEST
    private bool modelPrincipal = false;
    public static ProtectedGuiIdentity CreateForTest(string sid, int session)
    {
        var value = new ProtectedGuiIdentity(); value.modelPrincipal = true;
        value.originalElevated = new Observation { Sid = sid, Session = session, Type = 1, ElevationType = 2, Elevated = 1,
            Integrity = "S-1-16-12288", Authentication = "0000000000000001", Token = "0000000000000002", Modified = "0000000000000003" };
        value.originalLimited = new Observation { Sid = sid, Session = session, Type = 1, ElevationType = 3, Elevated = 0,
            Integrity = "S-1-16-8192", Authentication = "0000000000000004", Token = "0000000000000005", Modified = "0000000000000006" };
        value.CheckCurrent(); return value;
    }
    public static bool CheckPairForTest(string fullSid, string limitedSid, int fullSession, int limitedSession, int fullType, int limitedType, string fullIntegrity, string limitedIntegrity)
    {
        try
        {
            CheckPair(new Observation { Sid = fullSid, Session = fullSession, Type = 1, ElevationType = fullType, Elevated = 1, Integrity = fullIntegrity },
                new Observation { Sid = limitedSid, Session = limitedSession, Type = 1, ElevationType = limitedType, Elevated = 0, Integrity = limitedIntegrity });
            return true;
        }
        catch (InvalidDataException) { return false; }
    }
    public static bool SameForTest(string token, string authentication, string integrity, string modified)
    {
        var original = new Observation { Token = "token", Authentication = "auth", Sid = "sid", Session = 1, Type = 1, Integrity = "high", Modified = "original" };
        return original.Same(new Observation { Token = token, Authentication = authentication, Sid = "sid", Session = 1, Type = 1, Integrity = integrity, Modified = modified });
    }
#endif
}
