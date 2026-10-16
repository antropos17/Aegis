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
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateTokenEx(SafeFileHandle token, uint access, IntPtr security, int level, int type, out SafeFileHandle copy);
    [DllImport("shell32.dll")] private static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, SafeFileHandle token, out IntPtr path);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool ImpersonateLoggedOnUser(SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool RevertToSelf();
    private readonly object lifecycle = new object();
    private ProtectedGuiProcessLease processOwner;
    private SafeFileHandle elevated, limited;
    private Observation originalElevated, originalLimited;
    private bool closed, refused;
#if PROTECTED_GUI_PROCESS_TEST
    [ThreadStatic] private static string processTestPhase;
#endif
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
        int sizingError = Marshal.GetLastWin32Error();
#if PROTECTED_GUI_PROCESS_TEST
        if (processTestPhase != null) processTestPhase = "query-" + kind + "-sizing-" + (sized ? 1 : 0) + "-error-" + sizingError + "-length-" + length;
#endif
        // This fixed TokenElevation structure reports ERROR_BAD_LENGTH on the
        // inbox runtime. Its actual second query must still return exactly four.
        Need(!sized && (sizingError == 122 || (kind == 20 && sizingError == 24 && length == 4)) && length > 0 && length <= 65536);
        IntPtr data = Marshal.AllocHGlobal(length);
        try
        {
            int returned; bool queried = GetTokenInformation(token, kind, data, length, out returned); int error = Marshal.GetLastWin32Error();
#if PROTECTED_GUI_PROCESS_TEST
            if (processTestPhase != null) processTestPhase = "query-" + kind + "-read-" + (queried ? 1 : 0) + "-error-" + error + "-returned-" + returned + "-buffer-" + length;
#endif
            Need(queried && returned > 0 && returned <= length);
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
#if PROTECTED_GUI_PROCESS_TEST
        if (processTestPhase != null) processTestPhase = "no-impersonation-opened-" + (opened ? 1 : 0) + "-error-" + error;
#endif
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
    public void CheckCurrent() { lock (lifecycle) CheckCurrentCore(); }
    private void CheckCurrentCore()
    {
        try
        {
            Need(!closed && !refused); NoImpersonation();
#if PROTECTED_GUI_TEST
            if (modelPrincipal) {
#if PROTECTED_GUI_PROCESS_TEST
                if (modelProcess) { using (var current = CurrentToken()) Need(originalLimited.Same(Observe(current))); return; }
#endif
                CheckPair(originalElevated, originalLimited); return;
            }
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
    private sealed class LifecycleEntry : IDisposable {
        private readonly object gate; private bool owned;
        internal LifecycleEntry(object value) { gate = value; System.Threading.Monitor.Enter(gate, ref owned); }
        public void Dispose() { if (owned) { owned = false; System.Threading.Monitor.Exit(gate); } }
    }
    public IDisposable EnterLifecycle() { return new LifecycleEntry(lifecycle); }
    public void AssertProcessIdle() { lock (lifecycle) Need(processOwner == null); }
    internal void BindProcess(ProtectedGuiProcessLease owner) {
        lock (lifecycle) { CheckCurrentCore(); Need(owner != null && processOwner == null); processOwner = owner; }
    }
    internal void ReleaseProcess(ProtectedGuiProcessLease owner) {
        lock (lifecycle) { Need(Object.ReferenceEquals(processOwner, owner)); processOwner = null; }
    }
    internal SafeFileHandle DuplicateLimitedForProcess() {
        lock (lifecycle) {
            CheckCurrentCore(); SafeFileHandle copy = null;
            try { Need(DuplicateTokenEx(limited, 0xBU, IntPtr.Zero, 2, 1, out copy));
                Need(SamePrincipal(originalLimited, Observe(copy))); return copy;
            } catch { if (copy != null) copy.Dispose(); throw; }
        }
    }
    internal string LocalAppDataForProcess() {
        lock (lifecycle) {
            CheckCurrentCore();
#if PROTECTED_GUI_TEST && PROTECTED_GUI_PROCESS_TEST
            if (modelProcess) return modelLocalAppData;
#endif
            var folder = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091"); IntPtr value = IntPtr.Zero;
            try {
                Need(SHGetKnownFolderPath(ref folder, 0, limited, out value) == 0 && value != IntPtr.Zero);
                string path = Marshal.PtrToStringUni(value); Need(path != null && path.Length > 0 && path.Length <= 2048 &&
                    Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) && path.IndexOf(':', 2) < 0 &&
                    String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
                CheckCurrentCore(); return path;
            } finally { if (value != IntPtr.Zero) Marshal.FreeCoTaskMem(value); }
        }
    }
    private static bool SamePrincipal(Observation expected, Observation current) {
        return expected != null && current != null && expected.Sid == current.Sid && expected.Authentication == current.Authentication &&
            expected.Session == current.Session && expected.Type == current.Type && expected.Integrity == current.Integrity &&
            expected.ElevationType == current.ElevationType && expected.Elevated == current.Elevated &&
            expected.AppContainer == current.AppContainer && expected.UiAccess == current.UiAccess;
    }
    internal sealed class ProcessBinding : IDisposable {
        private SafeFileHandle held; private readonly Observation original;
        private ProcessBinding(SafeFileHandle token) { held = token; original = Observe(token); }
        internal void Check(ProtectedGuiProcessNative process) {
            Need(held != null && original.Same(Observe(held))); SafeFileHandle current = null;
            try { current = process.OpenRootToken(); Need(original.Same(Observe(current))); }
            finally { if (current != null) current.Dispose(); }
        }
        public void Dispose() { if (held != null) { held.Dispose(); held = null; } }
        internal static ProcessBinding Capture(ProtectedGuiIdentity identity, ProtectedGuiProcessNative process) {
            identity.CheckCurrent(); SafeFileHandle token = null;
            try { token = process.OpenRootToken(); Need(SamePrincipal(identity.originalLimited, Observe(token)));
                var result = new ProcessBinding(token); token = null; return result;
            } finally { if (token != null) token.Dispose(); }
        }
    }
    private sealed class ProfileContext : IDisposable {
        private SafeFileHandle token; private bool impersonated;
        internal ProfileContext(SafeFileHandle selected) {
            token = selected;
            try { NoImpersonation(); Need(ImpersonateLoggedOnUser(token)); impersonated = true; }
            catch { token.Dispose(); throw; }
        }
        public void Dispose() {
            if (!impersonated) return;
            impersonated = false;
            try {
                if (!RevertToSelf()) { var failure = new InvalidDataException("protected-gui-process-cleanup-unknown"); failure.Data["protectedCleanupUnknown"] = true; throw failure; }
                NoImpersonation();
            } finally { token.Dispose(); token = null; }
        }
    }
    private sealed class EmptyContext : IDisposable { public void Dispose() { } }
    internal IDisposable EnterProfileContext() {
        CheckCurrent();
#if PROTECTED_GUI_TEST && PROTECTED_GUI_PROCESS_TEST
        if (modelProcess) return new EmptyContext();
#endif
        return new ProfileContext(DuplicateLimitedForProcess());
    }
    public void Dispose()
    { lock (lifecycle) { Need(processOwner == null); if (closed) return; closed = true; try { if (limited != null) limited.Dispose(); } finally { if (elevated != null) elevated.Dispose(); } } }
#if PROTECTED_GUI_TEST
    private bool modelPrincipal = false;
#if PROTECTED_GUI_PROCESS_TEST
    private bool modelProcess = false;
    private string modelLocalAppData;
    internal bool IsProcessModel { get { return modelProcess; } }
    public static ProtectedGuiIdentity CreateForProcessTest(string fixtureLocalAppData) {
        processTestPhase = "path";
        try {
        Need(fixtureLocalAppData != null && Path.IsPathRooted(fixtureLocalAppData) && Directory.Exists(fixtureLocalAppData));
        processTestPhase = "process-open";
        using (var current = CurrentToken()) {
            var observed = Observe(current); var result = new ProtectedGuiIdentity();
            result.modelPrincipal = true; result.modelProcess = true;
            result.originalElevated = new Observation { Sid = observed.Sid, Session = Math.Max(1, observed.Session), Type = 1,
                ElevationType = 2, Elevated = 1, Integrity = "S-1-16-12288", Authentication = "0000000000000001", Token = "0000000000000002" };
            result.modelLocalAppData = Path.GetFullPath(fixtureLocalAppData); result.originalLimited = observed; result.CheckCurrent(); return result;
        }
        } catch (Exception failure) { throw new InvalidDataException("protected-gui-process-test-" + processTestPhase, failure); }
        finally { processTestPhase = null; }
    }
#endif
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
