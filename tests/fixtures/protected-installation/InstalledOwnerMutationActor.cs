using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class InstalledOwnerMutationActor
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint rights, uint share, IntPtr security, uint create, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool DeleteFile(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool MoveFileEx(string source, string destination, uint flags);
    private const string Root = "C:\\ProgramData\\AEGIS\\ProtectedSession";
    public static int Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathRooted(args[0]) || args[0].IndexOf(':', 2) >= 0) return 2;
        string scratch = Path.GetFullPath(args[0]); var rows = new List<string>(); bool passed = true;
        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        bool admin = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        if (admin || identity.User.Value == "S-1-5-18") return 3;
        string replacement = Path.Combine(scratch, "replacement.bin"), output = Path.Combine(scratch, "actor-result.json");
        try {
            File.WriteAllText(replacement, "allowed-disposable-replacement");
            string[] leaves = { "aegis-owner.exe", "aegis-session.exe", "aegis-main.exe", "owner-policy.json", "enrollment.json", "inventory.json", "main-registration.json", "operator.credential", "registered-vm.json" };
            foreach (string leaf in leaves) {
                string path = Path.Combine(Root, leaf); int code;
                using (SafeFileHandle file = CreateFile(path, 0x40000000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
                    code = file.IsInvalid ? Marshal.GetLastWin32Error() : 0;
                }
                passed &= Add(rows, leaf + ":write", code);
                passed &= Add(rows, leaf + ":writeDac", Access(path, 0x40000, false));
                passed &= Add(rows, leaf + ":writeOwner", Access(path, 0x80000, false));
                bool deleted = DeleteFile(path); code = deleted ? 0 : Marshal.GetLastWin32Error();
                passed &= Add(rows, leaf + ":delete", code);
                bool replaced = MoveFileEx(replacement, path, 1); code = replaced ? 0 : Marshal.GetLastWin32Error();
                passed &= Add(rows, leaf + ":replace", code);
                if (!File.Exists(replacement)) File.WriteAllText(replacement, "allowed-disposable-replacement");
            }
            foreach (string path in new[] { Root, "C:\\ProgramData\\AEGIS", "C:\\ProgramData\\AEGIS\\Receipts" }) {
                bool changed = MoveFileEx(path, path + "-attacker", 0); int code = changed ? 0 : Marshal.GetLastWin32Error();
                passed &= Add(rows, Path.GetFileName(path) + ":rename", code);
                passed &= Add(rows, Path.GetFileName(path) + ":writeDac", Access(path, 0x40000, true));
                passed &= Add(rows, Path.GetFileName(path) + ":writeOwner", Access(path, 0x80000, true));
            }
            using (SafeFileHandle file = CreateFile(Path.Combine(Root, "operator.credential"), 0x80000000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
                passed &= Add(rows, "credential:read", file.IsInvalid ? Marshal.GetLastWin32Error() : 0);
            }
            bool readable = File.ReadAllBytes(Path.Combine(Root, "owner-policy.json")).Length > 0;
            string writeMarker = Path.Combine(scratch, "write-marker.txt"), deleteMarker = Path.Combine(scratch, "delete-original.txt"), replaceMarker = Path.Combine(scratch, "replace-original.txt");
            File.WriteAllText(writeMarker, "allowed-disposable-write"); bool write = File.ReadAllText(writeMarker) == "allowed-disposable-write";
            File.Delete(deleteMarker); bool delete = !File.Exists(deleteMarker);
            bool moved = MoveFileEx(replacement, replaceMarker, 1);
            int replaceError = moved ? 0 : Marshal.GetLastWin32Error();
            bool replace = moved && File.ReadAllText(replaceMarker) == "allowed-disposable-replacement";
            // Match the kernel access checks above on disposable same-volume
            // objects. Success grants the requested right; no protected ACL is set.
            bool writeDac = Access(replaceMarker, 0x40000, false) == 0 && Access(scratch, 0x40000, true) == 0;
            bool writeOwner = Access(replaceMarker, 0x80000, false) == 0 && Access(scratch, 0x80000, true) == 0;
            passed &= readable && write && delete && replace && writeDac && writeOwner;
            string json = "{\"schemaVersion\":1,\"passed\":" + (passed ? "true" : "false") +
                ",\"operatorSid\":\"" + identity.User.Value + "\",\"administrator\":false,\"policyReadable\":" + (readable ? "true" : "false") +
                ",\"permitted\":{\"write\":" + (write ? "true" : "false") + ",\"delete\":" + (delete ? "true" : "false") +
                ",\"replace\":" + (replace ? "true" : "false") + ",\"writeDac\":" + (writeDac ? "true" : "false") +
                ",\"writeOwner\":" + (writeOwner ? "true" : "false") + ",\"replaceWin32\":" + replaceError + "},\"attempts\":[" + String.Join(",", rows) + "]}";
            File.WriteAllText(output, json, new UTF8Encoding(false)); return passed ? 0 : 1;
        } catch { return 4; }
    }
    private static int Access(string path, uint rights, bool directory)
    {
        using (SafeFileHandle file = CreateFile(path, rights, 7, IntPtr.Zero, 3, directory ? 0x02200000U : 0x00200000U, IntPtr.Zero)) {
            return file.IsInvalid ? Marshal.GetLastWin32Error() : 0;
        }
    }
    private static bool Add(List<string> rows, string label, int code)
    {
        rows.Add("{\"action\":\"" + label + "\",\"win32Error\":" + code + ",\"denied\":" + (code == 5 ? "true" : "false") + "}"); return code == 5;
    }
}

// An independent qualification launcher observes the suspended actor's actual
// token through its original process handle before any actor code can execute.
public static class InstalledOwnerMutationLauncher
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Startup { internal int size; internal string reserved, desktop, title; internal int x,y,cx,cy,charsX,charsY,fill,flags; internal short show,reservedBytes; internal IntPtr reserved2,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { internal IntPtr process, thread; internal uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { internal IntPtr sid; internal uint attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint low; internal int high; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithLogonW(string user, string domain, string password, uint logon, string application,
        StringBuilder command, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint rights, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeName(string system, ref Luid luid, StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr value, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr value, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, byte[] data, uint size, out uint needed);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
    private static void Require(bool value) { if (!value) throw new InvalidDataException("installed-mutation-launch-refused"); }
    private static void RequireNative(bool value)
    {
        if (value) return;
        int error = Marshal.GetLastWin32Error();
        var failure = new InvalidDataException("installed-mutation-launch-refused");
        failure.Data["protectedNativeWin32"] = error; throw failure;
    }
    private static byte[] Token(IntPtr token, int kind)
    {
        int needed; GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed); Require(needed > 0 && needed < 65536);
        IntPtr data = Marshal.AllocHGlobal(needed);
        try { Require(GetTokenInformation(token, kind, data, needed, out needed)); byte[] bytes = new byte[needed]; Marshal.Copy(data, bytes, 0, needed); return bytes; }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static string TokenSid(IntPtr token, int kind)
    {
        int needed; GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed); Require(needed > 0 && needed < 65536);
        IntPtr data = Marshal.AllocHGlobal(needed);
        try { Require(GetTokenInformation(token, kind, data, needed, out needed)); return new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static List<Dictionary<string,object>> StandardGroups(IntPtr token)
    {
        int needed; GetTokenInformation(token, 2, IntPtr.Zero, 0, out needed); Require(needed > 0 && needed < 65536);
        IntPtr data = Marshal.AllocHGlobal(needed);
        try {
            Require(GetTokenInformation(token, 2, data, needed, out needed)); int count = Marshal.ReadInt32(data);
            int offset = IntPtr.Size == 8 ? 8 : 4, stride = Marshal.SizeOf(typeof(SidAttributes));
            Require(count >= 0 && count <= 1024 && offset + count * stride <= needed);
            var rows = new List<Dictionary<string,object>>();
            for (int index = 0; index < count; index++) {
                var group = (SidAttributes)Marshal.PtrToStructure(IntPtr.Add(data, offset + index * stride), typeof(SidAttributes));
                string sid = new SecurityIdentifier(group.sid).Value;
                // Deny-only membership remains an administrator-capable profile.
                Require(sid != "S-1-5-32-544" && sid != "S-1-5-32-547" && sid != "S-1-5-32-548" && sid != "S-1-5-32-549" &&
                    sid != "S-1-5-32-550" && sid != "S-1-5-32-551" && sid != "S-1-5-32-552" &&
                    !sid.EndsWith("-512", StringComparison.Ordinal) && !sid.EndsWith("-518", StringComparison.Ordinal) && !sid.EndsWith("-519", StringComparison.Ordinal));
                rows.Add(new Dictionary<string,object> { { "sid", sid }, { "attributes", group.attributes } });
            }
            return rows;
        } finally { Marshal.FreeHGlobal(data); }
    }
    private static List<Dictionary<string,object>> StandardPrivileges(IntPtr token)
    {
        byte[] bytes = Token(token, 3); int count = BitConverter.ToInt32(bytes, 0);
        Require(count >= 0 && count <= 256 && 4 + count * 12 <= bytes.Length);
        var rows = new List<Dictionary<string,object>>();
        for (int index = 0; index < count; index++) {
            int offset = 4 + index * 12; var luid = new Luid { low = BitConverter.ToUInt32(bytes, offset), high = BitConverter.ToInt32(bytes, offset + 4) };
            uint attributes = BitConverter.ToUInt32(bytes, offset + 8), length = 128; var name = new StringBuilder((int)length);
            Require(LookupPrivilegeName(null, ref luid, name, ref length)); string value = name.ToString();
            Require(value == "SeChangeNotifyPrivilege" || value == "SeShutdownPrivilege" || value == "SeUndockPrivilege" || value == "SeIncreaseWorkingSetPrivilege" || value == "SeTimeZonePrivilege");
            Require((attributes & 2) == 0 || value == "SeChangeNotifyPrivilege");
            rows.Add(new Dictionary<string,object> { { "name", value }, { "attributes", attributes } });
        }
        return rows;
    }
    public static Dictionary<string,object> Run(string executable, string user, string password, string scratch, string expectedSid)
    {
        Require(Path.GetFileName(executable) == "installed-owner-actor.exe" && executable.IndexOf('"') < 0 && scratch.IndexOf('"') < 0);
        var evidence = new Dictionary<string,object>(); Startup startup = new Startup(); startup.size = Marshal.SizeOf(typeof(Startup));
        ProcessInfo child = new ProcessInfo(); IntPtr token = IntPtr.Zero, job = IntPtr.Zero, environment = IntPtr.Zero; bool settled = false, assigned = false;
        CloudGuestDesktop desktop = null;
        string checkpoint = "installed-mutation-job"; Exception originalFailure = null;
        try {
            job = CreateJobObject(IntPtr.Zero, null); RequireNative(job != IntPtr.Zero);
            byte[] limits = new byte[144]; Array.Copy(BitConverter.GetBytes(0x2000U), 0, limits, 16, 4);
            RequireNative(SetInformationJobObject(job, 9, limits, (uint)limits.Length));
            environment = Marshal.StringToHGlobalUni("SystemRoot=C:\\Windows\0TEMP=" + scratch + "\0TMP=" + scratch + "\0WINDIR=C:\\Windows\0\0");
            checkpoint = "installed-mutation-desktop";
            desktop = new CloudGuestDesktop(expectedSid, true);
            Require(desktop.Restored && desktop.ThreadDesktopPreserved);
            startup.desktop = desktop.Path;
            checkpoint = "installed-mutation-create";
            RequireNative(CreateProcessWithLogonW(user, ".", password, 0, executable, new StringBuilder("\"" + executable + "\" \"" + scratch + "\""), 4 | 0x08000000 | 0x400, environment, scratch, ref startup, out child));
            checkpoint = "installed-mutation-bind";
            assigned = AssignProcessToJobObject(job, child.process); RequireNative(assigned);
            // A query-only handle observes every group and assigned privilege;
            // no token handle is delivered to the actor.
            checkpoint = "installed-mutation-token-query";
            RequireNative(OpenProcessToken(child.process, 8, out token));
            checkpoint = "installed-mutation-profile";
            string sid = TokenSid(token, 1), integrity = TokenSid(token, 25);
            byte[] statistics = Token(token, 10), session = Token(token, 12), elevation = Token(token, 20);
            Require(sid == expectedSid && integrity == "S-1-16-8192" && BitConverter.ToUInt32(elevation, 0) == 0);
            Require(BitConverter.ToUInt32(Token(token, 8), 0) == 1 && Token(token, 21)[0] == 0 &&
                BitConverter.ToUInt32(Token(token, 26), 0) == 0 && BitConverter.ToUInt32(Token(token, 29), 0) == 0 && BitConverter.ToUInt32(Token(token, 11), 0) == 0);
            checkpoint = "installed-mutation-groups"; evidence["groups"] = StandardGroups(token);
            checkpoint = "installed-mutation-privileges"; evidence["privileges"] = StandardPrivileges(token);
            evidence["adminCapable"] = false; evidence["powerfulPrivilegesAssigned"] = false; evidence["strictStandardProfile"] = true;
            checkpoint = "installed-mutation-birth";
            long birth, exit, kernel, cpu; Require(GetProcessTimes(child.process, out birth, out exit, out kernel, out cpu) && birth > 0);
            evidence["pid"] = child.pid; evidence["birthFileTime"] = birth; evidence["operatorSid"] = sid; evidence["integritySid"] = integrity;
            evidence["elevated"] = false; evidence["enabledAdministrator"] = false; evidence["authentication"] = BitConverter.ToUInt64(statistics, 8).ToString("x16"); evidence["session"] = BitConverter.ToUInt32(session, 0);
            checkpoint = "installed-mutation-release";
            var completion = System.Diagnostics.Stopwatch.StartNew();
            Require(ResumeThread(child.thread) == 1 && WaitForSingleObject(child.process, 10000) == 0);
            checkpoint = "installed-mutation-exit";
            uint code; Require(GetExitCodeProcess(child.process, out code)); evidence["exitCode"] = code;
            checkpoint = "installed-mutation-census";
            byte[] census = new byte[48]; uint needed;
            int queries = 0; uint initialActive = 0;
            while (true) {
                RequireNative(QueryInformationJobObject(job, 1, census, (uint)census.Length, out needed));
                Require(needed == census.Length); uint active = BitConverter.ToUInt32(census, 40);
                if (queries++ == 0) initialActive = active;
                if (active == 0) break;
                // Process signaling may precede Job accounting. Share the existing
                // completion budget; no new wait extends the actor deadline.
                Require(completion.ElapsedMilliseconds < 10000); System.Threading.Thread.Sleep(2);
            }
            evidence["initialActiveProcesses"] = initialActive; evidence["censusQueries"] = queries;
            evidence["jobEmpty"] = true; evidence["exactProcessExited"] = true; settled = true; return evidence;
        } catch (Exception failure) { originalFailure = failure; failure.Data["protectedOperation"] = checkpoint; throw; }
        finally {
            bool cleanup = true;
            if (!settled && job != IntPtr.Zero) {
                cleanup = TerminateJobObject(job, 1);
                if (!assigned && child.process != IntPtr.Zero) cleanup &= TerminateProcess(child.process, 1);
                if (child.process != IntPtr.Zero) cleanup &= WaitForSingleObject(child.process, 5000) == 0;
                byte[] census = new byte[48]; uint needed;
                cleanup &= QueryInformationJobObject(job, 1, census, (uint)census.Length, out needed) && BitConverter.ToUInt32(census, 40) == 0;
            }
            if (token != IntPtr.Zero) cleanup &= CloseHandle(token);
            if (child.thread != IntPtr.Zero) cleanup &= CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) cleanup &= CloseHandle(child.process);
            if (job != IntPtr.Zero) cleanup &= CloseHandle(job);
            // The borrowed/default desktop is never modified. Release only our
            // fresh objects after the retained process and Job have closed.
            if (desktop != null && cleanup) {
                desktop.Dispose(); cleanup &= desktop.Closed;
            }
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (originalFailure != null) originalFailure.Data["installedMutationCleanupConfirmed"] = cleanup;
            if (!cleanup) throw new InvalidDataException("installed-mutation-cleanup-unknown", originalFailure);
        }
    }
}
