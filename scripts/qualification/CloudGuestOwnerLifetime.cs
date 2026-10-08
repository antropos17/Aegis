using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Disposable qualification executable. It supplies no production admission.
internal static class CloudGuestOwnerLifetime
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        internal int Size; internal string Reserved, Desktop, Title;
        internal uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        internal ushort Show, ReservedLength;
        internal IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User, Job; internal uint Flags; internal IntPtr Min, Max; internal uint Active; internal IntPtr Affinity; internal uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io
    { internal ulong R, W, O, RB, WB, OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    { internal Basic Basic; internal Io Io; internal IntPtr P, J, PP, PJ; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcessW(
        string application, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr environment, string cwd, ref Startup startup, out ProcessInfo info);
    private static string stage = "initialize";
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("fixed-owner-lifetime-refused"); }
    private static string Quote(string path) { Need(!path.Contains("\"") && !path.EndsWith("\\")); return "\"" + path + "\""; }
    private static uint Exit(IntPtr handle)
    { uint code = 259; Need(GuestJobNative.WaitForSingleObject(handle, 2000) == 0 && GetExitCodeProcess(handle, out code) && code != 259); return code; }
    private static string Line(Process process)
    { var line = process.StandardOutput.ReadLineAsync(); Need(line.Wait(4000) && line.Result != null && line.Result.Length <= 128); return line.Result; }
    private static void Owner(string node, string folder, string name, bool killOnClose)
    {
        IntPtr job = IntPtr.Zero; ProcessInfo root = new ProcessInfo();
        try
        {
            stage = "owner-job-create"; job = CreateJobObject(IntPtr.Zero, name);
            Need(job != IntPtr.Zero && Marshal.GetLastWin32Error() != 183);
            var limits = new Limits(); limits.Basic.Flags = 8 | (killOnClose ? 0x2000u : 0u); limits.Basic.Active = 4;
            Need(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
            // Spawn the fixed trusted Node bootstrap suspended, then assign before execution.
            var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup));
            stage = "owner-root-create";
            Need(CreateProcessW(node, new StringBuilder(Quote(node) + " " + Quote(Path.Combine(folder, "owner-lifetime-fixed-task.cjs"))),
                IntPtr.Zero, IntPtr.Zero, false, 4 | 0x08000000, IntPtr.Zero, folder, ref startup, out root));
            Need(AssignProcessToJobObject(job, root.Process));
            Console.WriteLine("owner-root:" + root.Pid);
            Need(ResumeThread(root.Thread) == 1);
            // Controller observes the OS Job census, never trusts payload-reported identity.
            Console.WriteLine("owner-running"); Console.Out.Flush();
            var command = Console.In.ReadLineAsync();
            Need(command.Wait(10000) && command.Result == "fixed-owner-exit");
            // Intentional fixed fixture exit. This is controlled lifecycle evidence.
            Environment.Exit(143);
        }
        finally
        {
            if (job != IntPtr.Zero) { TerminateJobObject(job, 138); GuestJobNative.CloseHandle(job); }
            if (root.Process != IntPtr.Zero) { TerminateProcess(root.Process, 138); GuestJobNative.CloseHandle(root.Process); }
            if (root.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(root.Thread);
        }
    }
    private static uint[] AwaitMembers(IntPtr job, string node, Dictionary<string, object> record)
    {
        var clock = Stopwatch.StartNew(); uint[] prior = new uint[0]; int stable = 0;
        do {
            uint[] members = GuestJobNative.Members(job); var counts = GuestJobNative.Counts(job);
            record["observedTotal"] = counts.Total; record["observedActive"] = counts.Active; record["observedMembers"] = members.Length;
            Need(counts.Total <= 4 && counts.Total == counts.Active);
            int nodes = 0, helpers = 0;
            foreach (uint pid in members) {
                IntPtr held = GuestJobNative.OpenMember(pid);
                try {
                    string image = GuestJobNative.Image(held);
                    if (String.Equals(image, node, StringComparison.OrdinalIgnoreCase)) nodes++;
                    else { Need(String.Equals(image, Path.Combine(Environment.SystemDirectory, "conhost.exe"), StringComparison.OrdinalIgnoreCase)); helpers++; }
                } finally { GuestJobNative.CloseHandle(held); }
            }
            Need(nodes <= 2 && helpers <= 2);
            bool same = prior.Length == members.Length;
            for (int index = 0; same && index < prior.Length; index++) same = prior[index] == members[index];
            stable = nodes == 2 && counts.Active == members.Length && same ? stable + 1 : 0;
            if (stable >= 5) return members;
            prior = members; System.Threading.Thread.Sleep(20);
        } while (clock.ElapsedMilliseconds < 3000);
        throw new InvalidOperationException("descendant-not-observed");
    }
    private static Dictionary<string, object> Run(string node, string folder, bool recovery, bool mutation, string expectedStandardSid)
    {
        string name = "Local\\AegisCrash-" + Guid.NewGuid().ToString("N");
        IntPtr job = IntPtr.Zero, root = IntPtr.Zero, descendant = IntPtr.Zero;
        GuestJobInventory inventory = null; Process owner = null;
        var censusHandles = new List<IntPtr>();
        bool passed = false, termination = false, closure = false, released = false;
        var record = new Dictionary<string, object>();
        record["case"] = recovery ? "owner-controlled-exit-controller-recovery" : "owner-controlled-exit-kill-on-close";
        record["launchAllowed"] = false; record["e3Qualified"] = false; record["fullE33Accepted"] = false;
        record["e2Qualified"] = false; record["e6Qualified"] = false; record["acceptancePassed"] = false;
        try
        {
            stage = "controller-owner-create";
            var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
                "--owner " + Quote(node) + " " + Quote(folder) + " " + Quote(name) + " " + (!recovery && mutation ? "disabled" : "enabled"));
            start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            start.RedirectStandardInput = true;
            start.EnvironmentVariables.Clear(); start.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot");
            start.EnvironmentVariables["TEMP"] = folder; start.EnvironmentVariables["TMP"] = folder;
            start.EnvironmentVariables["NODE_DISABLE_COMPILE_CACHE"] = "1";
            owner = Process.Start(start); IntPtr ownerHandle = owner.Handle;
            string first = Line(owner); uint rootPid;
            Need(first.StartsWith("owner-root:", StringComparison.Ordinal) && uint.TryParse(first.Substring(11), out rootPid));
            rootPid = uint.Parse(first.Substring(11)); Need(Line(owner) == "owner-running");
            stage = "controller-job-open"; job = OpenJobObject(0x1f001f, false, name); Need(job != IntPtr.Zero);
            stage = "controller-census"; uint[] members = AwaitMembers(job, node, record); Need(Array.IndexOf(members, rootPid) >= 0);
            uint childPid = 0;
            foreach (uint pid in members) {
                // Trusted fixture cleanup authority is retained on this exact native identity.
                IntPtr held = OpenProcess(0x1000 | 0x100000 | 1, false, pid); Need(held != IntPtr.Zero); censusHandles.Add(held);
                GuestJobNative.Birth(held, job, pid);
                record["censusPrincipalsMatched"] = GuestJobNative.Principal(held) == WindowsIdentity.GetCurrent().User.Value;
                Need((bool)record["censusPrincipalsMatched"]);
                if (pid != rootPid && String.Equals(GuestJobNative.Image(held), node, StringComparison.OrdinalIgnoreCase)) { Need(childPid == 0); childPid = pid; }
            }
            Need(childPid != 0);
            stage = "controller-held-identities";
            root = GuestJobNative.OpenMember(rootPid); descendant = GuestJobNative.OpenMember(childPid);
            long birth = GuestJobNative.Birth(root, job, rootPid), childBirth = GuestJobNative.Birth(descendant, job, childPid);
            string sid = WindowsIdentity.GetCurrent().User.Value;
            record["standardPrincipalVerified"] = false;
            if (expectedStandardSid != null) {
                Need(sid == expectedStandardSid);
                foreach (IntPtr held in censusHandles) GuestJobNative.RequireStandardPrincipal(held, expectedStandardSid, GuestJobNative.Session(root));
                GuestJobNative.RequireStandardPrincipal(ownerHandle, expectedStandardSid, GuestJobNative.Session(root));
                record["standardPrincipalVerified"] = true;
            }
            record["rootImageMatched"] = GuestJobNative.Image(root).Equals(node, StringComparison.OrdinalIgnoreCase);
            record["descendantImageMatched"] = GuestJobNative.Image(descendant).Equals(node, StringComparison.OrdinalIgnoreCase);
            record["principalsMatched"] = GuestJobNative.Principal(root) == sid && GuestJobNative.Principal(descendant) == sid;
            Need((bool)record["rootImageMatched"] && (bool)record["descendantImageMatched"] && (bool)record["principalsMatched"]);
            stage = "controller-held-inventory";
            inventory = new GuestJobInventory(job, root, new string[] { node, Path.Combine(Environment.SystemDirectory, "conhost.exe") });
            stage = "controller-inventory-validate"; inventory.ValidateInitial();
            record["initialInventoryCount"] = inventory.InitialCount;
            Need(inventory.InitialCount == members.Length && !inventory.ConfirmClosure(0) && GuestJobNative.WaitForSingleObject(ownerHandle, 0) == 0x102);
            record["sid"] = sid; record["rootPid"] = rootPid; record["rootBirthFileTime"] = birth;
            record["descendantPid"] = childPid; record["descendantBirthFileTime"] = childBirth;
            record["heldIdentitiesVerifiedBeforeOwnerExit"] = true; record["preExitCensus"] = members.Length;
            record["liveClosureRefused"] = true; record["ownerAliveBeforeOwnerExit"] = true;
            if (!recovery)
            {
                stage = "witness-job-release"; inventory.Dispose(); Need(!inventory.ConfirmClosure(0)); inventory = null;
                Need(GuestJobNative.CloseHandle(job)); job = IntPtr.Zero; released = true;
            }
            stage = "owner-controlled-exit";
            owner.StandardInput.WriteLine("fixed-owner-exit"); owner.StandardInput.Flush();
            Need(Exit(ownerHandle) == 143);
            record["ownerExitCode"] = 143; record["ownerExitObserved"] = true;
            if (recovery)
            {
                stage = "controller-recovery";
                Need(GuestJobNative.WaitForSingleObject(root, 0) == 0x102 && GuestJobNative.WaitForSingleObject(descendant, 0) == 0x102);
                record["processesAliveAfterOwnerExit"] = true;
                if (!mutation) { Need(TerminateJobObject(job, 137)); termination = true; }
            }
            stage = "held-process-exits"; uint rootExit = Exit(root), childExit = Exit(descendant);
            if (recovery) Need(rootExit == 137 && childExit == 137);
            record["rootExitCode"] = rootExit; record["descendantExitCode"] = childExit;
            record["rootExitObserved"] = true; record["descendantExitObserved"] = true;
            foreach (IntPtr held in censusHandles) Exit(held);
            record["heldCensusExitObserved"] = true;
            stage = "closure-oracle";
            if (recovery) { closure = inventory.ConfirmClosure(2000); Need(closure && termination); }
            else Need(released);
            record["jobClosureConfirmed"] = recovery ? (object)closure : null;
            record["postExitJobObservation"] = recovery ? "confirmed-empty" : "handle-released-not-observed";
            record["cleanupJobTerminationAccepted"] = termination; record["witnessJobHandlesReleasedBeforeOwnerExit"] = released;
            passed = true; stage = "complete";
        }
        finally
        {
            // Cleanup never converts a failed observation into a passing case.
            record["passed"] = passed; record["failureStage"] = passed ? null : stage;
            if (job != IntPtr.Zero) TerminateJobObject(job, 138);
            if (root != IntPtr.Zero) { if (!passed) TerminateProcess(root, 138); GuestJobNative.CloseHandle(root); }
            if (descendant != IntPtr.Zero) { if (!passed) TerminateProcess(descendant, 138); GuestJobNative.CloseHandle(descendant); }
            foreach (IntPtr held in censusHandles) {
                if (!passed && GuestJobNative.WaitForSingleObject(held, 0) == 0x102) TerminateProcess(held, 138);
                GuestJobNative.CloseHandle(held);
            }
            if (inventory != null) inventory.Dispose();
            if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
            if (owner != null) { if (!owner.HasExited) { owner.Kill(); owner.WaitForExit(1000); } owner.Dispose(); }
            Print(record);
        }
        return record;
    }
    private static void Print(Dictionary<string, object> record)
    {
        // Only fixed keys, fixed enum values and native scalar observations cross stdout.
        var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
        Console.WriteLine(serializer.Serialize(record));
    }
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 5 && args[0] == "--owner")
            { Owner(args[1], args[2], args[3], args[4] == "enabled"); return 1; }
            bool guest = args.Length == 4 && args[0] == "--guest-all";
            Need(guest || (args.Length == 3 && (args[0] == "--all" || args[0] == "--missing-recovery" || args[0] == "--missing-kill-on-close")));
            string node = Path.GetFullPath(args[1]), folder = Path.GetFullPath(args[2]);
            Need(File.Exists(node) && File.Exists(Path.Combine(folder, "owner-lifetime-fixed-task.cjs")));
            string standardSid = guest ? args[3] : null;
            if (args[0] != "--missing-kill-on-close") Run(node, folder, true, args[0] == "--missing-recovery", standardSid);
            if (args[0] != "--missing-recovery") Run(node, folder, false, args[0] == "--missing-kill-on-close", standardSid);
            return 0;
        }
        catch { Console.Error.WriteLine("fixed-owner-lifetime-refused:" + stage); return 1; }
    }
}
