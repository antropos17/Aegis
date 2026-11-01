using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Security.Cryptography;

internal static class Guardian
{
    [StructLayout(LayoutKind.Sequential)] struct ProcessBasicInformation
    { public IntPtr ExitStatus, Peb, Affinity, Priority, ProcessId, ParentProcessId; }
    sealed class Member { internal IntPtr Handle; internal uint Pid, Parent; internal ulong Birth; internal string Kind, Image; internal bool Root; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, int size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder image, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out System.Runtime.InteropServices.ComTypes.FILETIME creation, out System.Runtime.InteropServices.ComTypes.FILETIME exit, out System.Runtime.InteropServices.ComTypes.FILETIME kernel, out System.Runtime.InteropServices.ComTypes.FILETIME user);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int kind, out ProcessBasicInformation info, int length, out int returned);
    static void Need(bool ok, string stage) { if (!ok) throw new InvalidOperationException(stage); }
    static string Hash(string file) { using (var f = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant(); }
    static ulong Birth(IntPtr process) {
        System.Runtime.InteropServices.ComTypes.FILETIME created, exited, kernel, user;
        Need(GetProcessTimes(process, out created, out exited, out kernel, out user), "member-times");
        return ((ulong)(uint)created.dwHighDateTime << 32) | (uint)created.dwLowDateTime;
    }
    static int Main(string[] args)
    {
        Native.Session session = null;
        List<IntPtr> held = new List<IntPtr>();
        bool jobEmpty = false;
        try {
            Need(args.Length == 7 && (args[4] == "effect" || args[4] == "spent" || args[4] == "decline"), "args");
            Need(Hash(args[0]) == args[5] && Hash(args[2]) == args[6], "fixture-hash-mismatch");
            Console.WriteLine("HASHES node=" + args[5] + " helper=" + args[6]);
            Console.WriteLine("PHASE " + args[4]);
            string root = args[3], systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            Need(Path.IsPathRooted(root) && Path.IsPathRooted(systemRoot), "paths");
            string env = "APPDATA=" + root + "\0HOME=" + root + "\0LOCALAPPDATA=" + root +
                "\0SystemRoot=" + systemRoot + "\0TEMP=" + root + "\0TMP=" + root +
                "\0USERPROFILE=" + root + "\0\0";
            session = Native.Start(args[0], root, new string[] {args[1], root, args[4]}, env);
            var bytes = new byte[64]; var output = new StringBuilder(); var watch = System.Diagnostics.Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 4000 && output.ToString().IndexOf("ready\n", StringComparison.Ordinal) < 0) {
                int n = Native.ReadAvailable(session.Output, session.Output.SafeFileHandle.DangerousGetHandle(), bytes);
                Need(n >= 0, "root-output-closed"); if (n > 0) output.Append(Encoding.ASCII.GetString(bytes, 0, n));
                Need(output.Length <= 64, "root-output-overflow");
            }
            Need(output.ToString() == "ready\n", "root-not-ready");
            Console.WriteLine("READY");
            Console.Out.Flush();
            var command = new StringBuilder(); watch.Restart();
            using (var input = Console.OpenStandardInput()) {
                while (watch.ElapsedMilliseconds < 2000 && command.ToString().IndexOf('\n') < 0) {
                    int n = Native.ReadAvailable(input, Native.StandardInput(), bytes);
                    Need(n >= 0, "control-closed"); if (n > 0) command.Append(Encoding.ASCII.GetString(bytes, 0, n));
                    Need(command.Length <= 16, "control-overflow");
                }
            }
            Need(command.ToString() == "CRASH\n", "control-refused");
            int size = 8 + 16 * IntPtr.Size;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try {
                Need(QueryInformationJobObject(session.Job, 3, buf, size, IntPtr.Zero), "job-enumeration");
                int assigned = Marshal.ReadInt32(buf, 0), listed = Marshal.ReadInt32(buf, 4);
                Console.WriteLine("COUNTS assigned=" + assigned + " listed=" + listed);
                Need(assigned >= 0 && listed >= 0 && listed <= 16 && listed <= assigned, "job-list-invalid");
                uint rootPid = GetProcessId(session.Process); int roots = 0, node = 0, helper = 0, other = 0;
                var members = new Dictionary<uint, Member>();
                for (int i = 0; i < listed; i++) {
                    uint pid = unchecked((uint)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64());
                    IntPtr member = OpenProcess(0x00100000 | 0x1000, false, pid);
                    Need(member != IntPtr.Zero, "open-member"); held.Add(member);
                    bool inJob; Need(IsProcessInJob(member, session.Job, out inJob) && inJob, "member-not-in-job");
                    Need(Native.WaitForSingleObject(member, 0) == 0x102, "member-already-exited");
                    var name = new StringBuilder(32768); uint length = (uint)name.Capacity;
                    Need(QueryFullProcessImageName(member, 0, name, ref length), "member-image");
                    string basename = Path.GetFileName(name.ToString());
                    Need(System.Text.RegularExpressions.Regex.IsMatch(basename, "^[A-Za-z0-9._-]{1,128}$"), "member-image-unsafe");
                    ulong birth = Birth(member);
                    ProcessBasicInformation basic; int returned;
                    Need(NtQueryInformationProcess(member, 0, out basic, Marshal.SizeOf(typeof(ProcessBasicInformation)), out returned) == 0, "member-parent");
                    Need(unchecked((uint)basic.ProcessId.ToInt64()) == pid && GetProcessId(member) == pid, "member-identity-changed");
                    uint parent = unchecked((uint)basic.ParentProcessId.ToInt64());
                    string kind;
                    if (String.Equals(name.ToString(), args[0], StringComparison.OrdinalIgnoreCase)) { node++; kind = "node"; }
                    else if (String.Equals(name.ToString(), args[2], StringComparison.OrdinalIgnoreCase)) { helper++; kind = "helper"; }
                    else { other++; kind = "other"; }
                    bool isRoot = pid == rootPid;
                    if (isRoot) roots++;
                    Console.WriteLine("MEMBER kind=" + kind + " image=" + basename + " pid=" + pid + " birthFileTime=" + birth + " observedParentPid=" + parent + " root=" + isRoot + " inJob=true live=true");
                    Need(!members.ContainsKey(pid), "duplicate-member");
                    members.Add(pid, new Member { Handle=member, Pid=pid, Parent=parent, Birth=birth, Kind=kind, Image=name.ToString(), Root=isRoot });
                }
                bool effectPhase = args[4] == "effect";
                int expected = effectPhase ? 3 : 1;
                Need(assigned == listed && listed >= expected && listed <= expected * 2, "job-member-count");
                Need(roots == 1 && node == (effectPhase ? 2 : 1) && helper == (effectPhase ? 1 : 0) && other == listed - expected, "member-identities");
                Member rootMember = members[rootPid], helperMember = null, peer = null;
                Need(rootMember.Kind == "node" && Birth(session.Process) == rootMember.Birth, "root-handle-identity");
                foreach (var m in members.Values) {
                    if (m.Kind == "helper") helperMember = m;
                    else if (m.Kind == "node" && !m.Root) peer = m;
                }
                if (effectPhase) Need(helperMember != null && peer != null && helperMember.Parent == rootPid && helperMember.Birth > rootMember.Birth &&
                    peer.Parent == helperMember.Pid && peer.Birth > helperMember.Birth, "expected-parent-chain");
                string systemHost = Path.Combine(Environment.SystemDirectory, "conhost.exe");
                var hosted = new HashSet<uint>();
                foreach (var m in members.Values) {
                    if (m.Kind != "other") continue;
                    Member parent;
                    Need(String.Equals(m.Image, systemHost, StringComparison.OrdinalIgnoreCase) && members.TryGetValue(m.Parent, out parent) &&
                        (parent.Pid == rootPid || (effectPhase && (parent.Pid == helperMember.Pid || parent.Pid == peer.Pid))) && parent.Birth < m.Birth && hosted.Add(parent.Pid), "unexpected-host");
                }
                Need(QueryInformationJobObject(session.Job, 3, buf, size, IntPtr.Zero), "final-job-enumeration");
                Need(Marshal.ReadInt32(buf, 0) == assigned && Marshal.ReadInt32(buf, 4) == listed, "final-count-changed");
                var finalIds = new HashSet<uint>();
                for (int i = 0; i < listed; i++) {
                    uint id = unchecked((uint)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64());
                    Need(finalIds.Add(id) && members.ContainsKey(id), "final-members-changed");
                }
                foreach (var m in members.Values) {
                    bool inJob;
                    Need(GetProcessId(m.Handle) == m.Pid && Birth(m.Handle) == m.Birth &&
                        Native.WaitForSingleObject(m.Handle, 0) == 0x102 &&
                        IsProcessInJob(m.Handle, session.Job, out inJob) && inJob, "final-member-invalid");
                }
                Console.WriteLine("GATE expectedParentChain=true exactSystemHosts=true finalMembershipStable=true heldRootIdentity=true");
            } finally { Marshal.FreeHGlobal(buf); }
            Need(TerminateProcess(session.Process, 77), "root-terminate");
            Need(Native.WaitForSingleObject(session.Process, 3000) == 0, "root-wait");
            jobEmpty = session.TerminateAndVerify(); Need(jobEmpty, "job-empty");
            foreach (var member in held) Need(Native.WaitForSingleObject(member, 3000) == 0, "member-exit");
            Console.WriteLine("PASS held-root terminated, outer Job empty, all held members signaled");
            return 0;
        } catch (Exception e) { Console.Error.WriteLine("FAIL " + e.Message); return 1; }
        finally {
            if (session != null) {
                if (!jobEmpty) jobEmpty = session.TerminateAndVerify();
                bool heldExited = true;
                foreach (var member in held) heldExited &= Native.WaitForSingleObject(member, 1000) == 0;
                Console.WriteLine("CLEANUP jobEmpty=" + jobEmpty + " heldCount=" + held.Count + " heldExited=" + heldExited);
                if (!jobEmpty || !heldExited) Console.Error.WriteLine("CLEANUP_UNCONFIRMED");
                session.Dispose();
            }
            foreach (var member in held) CloseHandle(member);
        }
    }
}
