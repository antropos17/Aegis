using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Threading;
using System.Collections.Generic;
using System.Text;
using System.Security.Principal;

// A live SCM handle prevents deletion/name reuse from selecting a later object.
public sealed class ProtectedInstallService : IDisposable
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string machine, string database, uint rights);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr manager, string name, uint rights);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateService(IntPtr manager, string name, string display, uint rights,
        uint type, uint start, uint error, string binary, string group, IntPtr tag,
        string dependencies, string account, string password);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryServiceConfig(IntPtr service, IntPtr data, uint size, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceStatusEx(IntPtr service, int level, byte[] data, uint size, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool StartService(IntPtr service, uint count, IntPtr arguments);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool ControlService(IntPtr service, uint code, byte[] status);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DeleteService(IntPtr service);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetServiceObjectSecurity(IntPtr service, uint info, byte[] descriptor);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceObjectSecurity(IntPtr service, uint info, byte[] descriptor, uint size, out uint needed);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint rights, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr value, uint timeout);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder text, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint rights, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
    private IntPtr service;
    private IntPtr ownerProcess;
    public Dictionary<string,object> ObservedOwner { get; private set; }
    public const string Name = "AegisProtectedSessionOwner";
    public const string Image = "\"C:\\ProgramData\\AEGIS\\ProtectedSession\\aegis-owner.exe\"";
    private static void Require(bool value) { if (!value) throw new InvalidDataException("protected-service-refused"); }
    private static InvalidDataException NativeFailure(string operation, int error)
    {
        var failure = new InvalidDataException("protected-service-native-refused");
        failure.Data["protectedOperation"] = operation; failure.Data["protectedNativeWin32"] = error;
        return failure;
    }
    // Call immediately after a failed SetLastError P/Invoke; invariants use Require.
    private static void Native(bool value, string operation)
    {
        if (!value) { int error = Marshal.GetLastWin32Error(); throw NativeFailure(operation, error); }
    }
    private static uint ObserveWait(IntPtr value, uint timeout)
    {
        uint result = WaitForSingleObject(value, timeout);
        if (result == 0xFFFFFFFF) { int error = Marshal.GetLastWin32Error(); throw NativeFailure("service-process-wait", error); }
        return result;
    }
    private ProtectedInstallService(IntPtr handle) { service = handle; }
    public static bool Absent()
    {
        IntPtr manager = OpenSCManager(null, null, 1); Native(manager != IntPtr.Zero, "service-manager-open");
        try {
            IntPtr found = OpenService(manager, Name, 4);
            if (found != IntPtr.Zero) { Native(CloseServiceHandle(found), "service-handle-close"); return false; }
            int error = Marshal.GetLastWin32Error(); if (error != 1060) throw NativeFailure("service-open", error); return true;
        } finally { CloseServiceHandle(manager); }
    }
    public static ProtectedInstallService Create()
    {
        IntPtr manager = OpenSCManager(null, null, 3); Native(manager != IntPtr.Zero, "service-manager-open");
        IntPtr result = IntPtr.Zero;
        try {
            // Existing names fail; no ChangeServiceConfig or preexisting-object adoption.
            result = CreateService(manager, Name, Name, 0xF01FF, 0x10, 3, 1, Image, null, IntPtr.Zero, null, "LocalSystem", null);
            Native(result != IntPtr.Zero, "service-create");
            var acl = new RawSecurityDescriptor("O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)");
            byte[] bytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes, 0);
            Native(SetServiceObjectSecurity(result, 5, bytes), "service-security-set");
            var value = new ProtectedInstallService(result); value.Recheck(); result = IntPtr.Zero; return value;
        } catch (Exception original) {
            if (result != IntPtr.Zero) {
                bool removed = DeleteService(result); int removeError = removed ? 0 : Marshal.GetLastWin32Error();
                bool closed = CloseServiceHandle(result); int closeError = closed ? 0 : Marshal.GetLastWin32Error(); result = IntPtr.Zero;
                bool absent = false;
                try { absent = Absent(); } catch { }
                if (!removed || !closed || !absent) {
                    var failure = new InvalidDataException("protected-service-creation-cleanup-unknown", original);
                    failure.Data["protectedCleanupUnknown"] = true;
                    if (!removed || !closed) { failure.Data["protectedOperation"] = !removed ? "service-delete" : "service-handle-close"; failure.Data["protectedNativeWin32"] = !removed ? removeError : closeError; }
                    throw failure;
                }
            }
            throw;
        } finally { CloseServiceHandle(manager); }
    }
    public string Configuration()
    {
        Require(service != IntPtr.Zero); uint size;
        bool probe = QueryServiceConfig(service, IntPtr.Zero, 0, out size); int probeError = probe ? 0 : Marshal.GetLastWin32Error();
        if (!probe && probeError != 122) throw NativeFailure("service-config-query", probeError); Require(size > 0 && size <= 16384);
        IntPtr data = Marshal.AllocHGlobal((int)size);
        try {
            Native(QueryServiceConfig(service, data, size, out size), "service-config-query");
            int binaryOffset = IntPtr.Size == 8 ? 16 : 12;
            int accountOffset = IntPtr.Size == 8 ? 48 : 28;
            uint type = unchecked((uint)Marshal.ReadInt32(data, 0)), start = unchecked((uint)Marshal.ReadInt32(data, 4));
            string binary = Marshal.PtrToStringUni(Marshal.ReadIntPtr(data, binaryOffset));
            string account = Marshal.PtrToStringUni(Marshal.ReadIntPtr(data, accountOffset));
            Require(type == 0x10 && start == 3 && binary == Image && account == "LocalSystem");
            return "own-process|demand|LocalSystem|" + binary;
        } finally { Marshal.FreeHGlobal(data); }
    }
    public string Security()
    {
        Require(service != IntPtr.Zero); uint needed;
        bool probe = QueryServiceObjectSecurity(service, 5, null, 0, out needed); int probeError = probe ? 0 : Marshal.GetLastWin32Error();
        if (!probe && probeError != 122) throw NativeFailure("service-security-query", probeError); Require(needed > 0 && needed <= 16384);
        byte[] bytes = new byte[needed]; Native(QueryServiceObjectSecurity(service, 5, bytes, needed, out needed), "service-security-query");
        var sd = new RawSecurityDescriptor(bytes, 0);
        Require(sd.Owner != null && (sd.Owner.Value == "S-1-5-18" || sd.Owner.Value == "S-1-5-32-544") && sd.DiscretionaryAcl != null);
        foreach (GenericAce entry in sd.DiscretionaryAcl) {
            CommonAce ace = entry as CommonAce; Require(ace != null && !ace.IsCallback);
            if (ace.AceQualifier == AceQualifier.AccessDenied) continue;
            Require(ace.AceQualifier == AceQualifier.AccessAllowed &&
                (ace.SecurityIdentifier.Value == "S-1-5-18" || ace.SecurityIdentifier.Value == "S-1-5-32-544"));
        }
        return sd.GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
    }
    public void Recheck() { Configuration(); Security(); }
    public uint[] Status()
    {
        Recheck(); uint needed; byte[] bytes = new byte[36];
        Native(QueryServiceStatusEx(service, 0, bytes, (uint)bytes.Length, out needed), "service-status-query");
        return new uint[] { BitConverter.ToUInt32(bytes, 4), BitConverter.ToUInt32(bytes, 28) };
    }
    private void Wait(uint state)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (Status()[0] != state) { Require(watch.ElapsedMilliseconds < 20000); Thread.Sleep(50); }
    }
    public void Start()
    {
        Recheck(); Require(Status()[0] == 1); WaitExited();
        if (ownerProcess != IntPtr.Zero) { CloseHandle(ownerProcess); ownerProcess = IntPtr.Zero; }
        Native(StartService(service, 0, IntPtr.Zero), "service-start"); Wait(4);
        uint pid = Status()[1]; Require(pid > 0); ownerProcess = OpenProcess(0x101000, false, pid); Native(ownerProcess != IntPtr.Zero, "service-process-open");
        Require(Status()[1] == pid && ObserveWait(ownerProcess, 0) == 258);
        IntPtr token = IntPtr.Zero;
        try {
            var name = new StringBuilder(2048); uint length = (uint)name.Capacity;
            Native(QueryFullProcessImageName(ownerProcess, 0, name, ref length), "service-process-image"); Require(name.ToString() == Image.Trim('"'));
            long birth, exit, kernel, user; Native(GetProcessTimes(ownerProcess, out birth, out exit, out kernel, out user), "service-process-times"); Require(birth > 0);
            Native(OpenProcessToken(ownerProcess, 8, out token), "service-token-open");
            int needed; bool probe = GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed); int probeError = probe ? 0 : Marshal.GetLastWin32Error();
            if (!probe && probeError != 122) throw NativeFailure("service-token-query", probeError); Require(needed > 0 && needed < 4096);
            IntPtr data = Marshal.AllocHGlobal(needed);
            string sid;
            try { Native(GetTokenInformation(token, 1, data, needed, out needed), "service-token-query"); sid = new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; }
            finally { Marshal.FreeHGlobal(data); }
            Require(sid == "S-1-5-18");
            byte[] statistics = TokenBytes(token, 10), session = TokenBytes(token, 12);
            ObservedOwner = new Dictionary<string,object>(); ObservedOwner["pid"] = pid; ObservedOwner["birthFileTime"] = birth;
            ObservedOwner["image"] = name.ToString(); ObservedOwner["sid"] = sid;
            ObservedOwner["authentication"] = BitConverter.ToUInt64(statistics, 8).ToString("x16"); ObservedOwner["session"] = BitConverter.ToUInt32(session, 0);
            ObservedOwner["exactProcessExited"] = false;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); }
    }
    private static byte[] TokenBytes(IntPtr token, int kind)
    {
        int needed; bool probe = GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed); int probeError = probe ? 0 : Marshal.GetLastWin32Error();
        if (!probe && probeError != 122) throw NativeFailure("service-token-query", probeError); Require(needed > 0 && needed < 4096);
        IntPtr data = Marshal.AllocHGlobal(needed);
        try { Native(GetTokenInformation(token, kind, data, needed, out needed), "service-token-query"); byte[] bytes = new byte[needed]; Marshal.Copy(data, bytes, 0, needed); return bytes; }
        finally { Marshal.FreeHGlobal(data); }
    }
    public void WaitExited()
    {
        if (ownerProcess == IntPtr.Zero) return;
        Require(ObserveWait(ownerProcess, 5000) == 0);
        if (ObservedOwner != null) ObservedOwner["exactProcessExited"] = true;
    }
    public void Stop()
    {
        Recheck(); uint state = Status()[0]; if (state == 1) { WaitExited(); return; }
        Require(state == 4); Native(ControlService(service, 1, new byte[28]), "service-stop"); Wait(1);
        WaitExited();
    }
    public void Delete()
    {
        Recheck(); Require(Status()[0] == 1); Native(DeleteService(service), "service-delete"); Dispose();
        Stopwatch watch = Stopwatch.StartNew();
        while (!Absent()) { Require(watch.ElapsedMilliseconds < 10000); Thread.Sleep(50); }
    }
    public void Dispose()
    {
        IntPtr value = service; service = IntPtr.Zero;
        if (ownerProcess != IntPtr.Zero) { CloseHandle(ownerProcess); ownerProcess = IntPtr.Zero; }
        if (value != IntPtr.Zero) Native(CloseServiceHandle(value), "service-handle-close");
    }
}
