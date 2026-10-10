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
    private ProtectedInstallService(IntPtr handle) { service = handle; }
    public static bool Absent()
    {
        IntPtr manager = OpenSCManager(null, null, 1); Require(manager != IntPtr.Zero);
        try {
            IntPtr found = OpenService(manager, Name, 4);
            if (found != IntPtr.Zero) { CloseServiceHandle(found); return false; }
            Require(Marshal.GetLastWin32Error() == 1060); return true;
        } finally { CloseServiceHandle(manager); }
    }
    public static ProtectedInstallService Create()
    {
        IntPtr manager = OpenSCManager(null, null, 3); Require(manager != IntPtr.Zero);
        IntPtr result = IntPtr.Zero;
        try {
            // Existing names fail; no ChangeServiceConfig or preexisting-object adoption.
            result = CreateService(manager, Name, Name, 0xF01FF, 0x10, 3, 1, Image, null, IntPtr.Zero, null, "LocalSystem", null);
            Require(result != IntPtr.Zero);
            var acl = new RawSecurityDescriptor("O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)");
            byte[] bytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes, 0);
            Require(SetServiceObjectSecurity(result, 5, bytes));
            var value = new ProtectedInstallService(result); value.Recheck(); result = IntPtr.Zero; return value;
        } catch {
            if (result != IntPtr.Zero) {
                bool removed = DeleteService(result); bool closed = CloseServiceHandle(result); result = IntPtr.Zero;
                if (!removed || !closed || !Absent()) throw new InvalidDataException("protected-service-creation-cleanup-unknown");
            }
            throw;
        } finally { CloseServiceHandle(manager); }
    }
    public string Configuration()
    {
        Require(service != IntPtr.Zero); uint size;
        QueryServiceConfig(service, IntPtr.Zero, 0, out size); Require(size > 0 && size <= 16384);
        IntPtr data = Marshal.AllocHGlobal((int)size);
        try {
            Require(QueryServiceConfig(service, data, size, out size));
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
        QueryServiceObjectSecurity(service, 5, null, 0, out needed); Require(needed > 0 && needed <= 16384);
        byte[] bytes = new byte[needed]; Require(QueryServiceObjectSecurity(service, 5, bytes, needed, out needed));
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
        Require(QueryServiceStatusEx(service, 0, bytes, (uint)bytes.Length, out needed));
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
        Require(StartService(service, 0, IntPtr.Zero)); Wait(4);
        uint pid = Status()[1]; Require(pid > 0); ownerProcess = OpenProcess(0x101000, false, pid); Require(ownerProcess != IntPtr.Zero);
        Require(Status()[1] == pid && WaitForSingleObject(ownerProcess, 0) == 258);
        IntPtr token = IntPtr.Zero;
        try {
            var name = new StringBuilder(2048); uint length = (uint)name.Capacity;
            Require(QueryFullProcessImageName(ownerProcess, 0, name, ref length) && name.ToString() == Image.Trim('"'));
            long birth, exit, kernel, user; Require(GetProcessTimes(ownerProcess, out birth, out exit, out kernel, out user) && birth > 0);
            Require(OpenProcessToken(ownerProcess, 8, out token));
            int needed; GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed); Require(needed > 0 && needed < 4096);
            IntPtr data = Marshal.AllocHGlobal(needed);
            string sid;
            try { Require(GetTokenInformation(token, 1, data, needed, out needed)); sid = new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; }
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
        int needed; GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed); Require(needed > 0 && needed < 4096);
        IntPtr data = Marshal.AllocHGlobal(needed);
        try { Require(GetTokenInformation(token, kind, data, needed, out needed)); byte[] bytes = new byte[needed]; Marshal.Copy(data, bytes, 0, needed); return bytes; }
        finally { Marshal.FreeHGlobal(data); }
    }
    public void WaitExited()
    {
        if (ownerProcess == IntPtr.Zero) return;
        Require(WaitForSingleObject(ownerProcess, 5000) == 0);
        if (ObservedOwner != null) ObservedOwner["exactProcessExited"] = true;
    }
    public void Stop()
    {
        Recheck(); uint state = Status()[0]; if (state == 1) { WaitExited(); return; }
        Require(state == 4); Require(ControlService(service, 1, new byte[28])); Wait(1);
        WaitExited();
    }
    public void Delete()
    {
        Recheck(); Require(Status()[0] == 1 && DeleteService(service)); Dispose();
        Stopwatch watch = Stopwatch.StartNew();
        while (!Absent()) { Require(watch.ElapsedMilliseconds < 10000); Thread.Sleep(50); }
    }
    public void Dispose()
    {
        IntPtr value = service; service = IntPtr.Zero;
        if (ownerProcess != IntPtr.Zero) { CloseHandle(ownerProcess); ownerProcess = IntPtr.Zero; }
        if (value != IntPtr.Zero) Require(CloseServiceHandle(value));
    }
}
