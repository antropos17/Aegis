using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using Aegis.ProtectedSession;

// Separate lab assembly. Launch/release/terminate authority stays in CloudGuestProcess.
public sealed class CloudGuestStdioPhase : ICloudGuestStdioPhase
{
    [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    private sealed class Member : IDisposable
    {
        internal readonly uint Pid;
        internal readonly IntPtr Handle;
        internal readonly long Birth;
        internal readonly string Image;
        private readonly IntPtr job;
        private readonly string sid;
        private readonly int session;
        internal Member(uint pid, IntPtr ownedJob, string expectedSid, int expectedSession)
        {
            Pid = pid; job = ownedJob; sid = expectedSid; session = expectedSession;
            Handle = GuestJobNative.OpenMember(pid);
            try { Birth = GuestJobNative.Birth(Handle, job, pid); Image = GuestJobNative.Image(Handle); Check(); }
            catch { GuestJobNative.CloseHandle(Handle); throw; }
        }
        internal void Check()
        {
            Need(GuestJobNative.Birth(Handle, job, Pid) == Birth && String.Equals(GuestJobNative.Image(Handle), Image, StringComparison.OrdinalIgnoreCase));
            GuestJobNative.RequireStandardPrincipal(Handle, sid, session);
        }
        public void Dispose() { GuestJobNative.CloseHandle(Handle); }
    }
    private readonly string sid;
    private readonly int kind;
    private readonly CloudGuestStdio transport;
    private readonly List<Member> original = new List<Member>(), observed = new List<Member>();
    private IntPtr job, root;
    private uint rootPid;
    private int session;
    private string rootImage;
    private long rootBirth;
    private bool captured, executed, exchangePassed;
    private const string helper = @"C:\ProgramData\AegisCloudLab\trusted\guest-stdio.exe";
    public CloudGuestStdioPhase(string expectedSid, int selectedKind)
    {
        Need(selectedKind >= 1 && selectedKind <= 5); sid = expectedSid; kind = selectedKind;
        transport = new CloudGuestStdio(sid);
    }
    public string EnvironmentBlock { get { return "AEGIS_STDIO_PREFIX=" + transport.Prefix + "\0AEGIS_STDIO_OWNER_PID=" + Process.GetCurrentProcess().Id + "\0AEGIS_STDIO_CASE=" + kind + "\0"; } }
    public void Capture(IntPtr heldRoot, IntPtr ownedJob, uint pid, string image, int expectedSession)
    {
        Need(!captured && !executed && ownedJob != IntPtr.Zero && heldRoot != IntPtr.Zero);
        root = GuestJobNative.Retain(heldRoot); job = GuestJobNative.Retain(ownedJob); rootPid = pid; rootImage = image; session = expectedSession;
        rootBirth = GuestJobNative.Birth(root, job, pid);
        var members = Census();
        try
        {
            foreach (var member in members) Need(member.Pid == pid ? Same(member.Image, image) : Same(member.Image, Path.Combine(Environment.SystemDirectory, "conhost.exe")));
            Need(members.Exists(delegate(Member member) { return member.Pid == pid; }));
            original.AddRange(members); members.Clear(); captured = true;
        }
        finally { foreach (var member in members) member.Dispose(); }
    }
    private List<Member> Census()
    {
        var before = GuestJobNative.Counts(job); uint[] pids = GuestJobNative.Members(job); var members = new List<Member>();
        try
        {
            Need(before.Total == before.Active && pids.Length == before.Active);
            foreach (uint pid in pids) members.Add(new Member(pid, job, sid, session));
            var after = GuestJobNative.Counts(job); uint[] again = GuestJobNative.Members(job);
            Need(before.Total == after.Total && before.Active == after.Active && pids.Length == again.Length);
            for (int at = 0; at < pids.Length; at++) Need(pids[at] == again[at]);
            foreach (var member in members) member.Check();
            return members;
        }
        catch { foreach (var member in members) member.Dispose(); throw; }
    }
    private void OriginalLive()
    {
        Need(GuestJobNative.Birth(root, job, rootPid) == rootBirth && Same(GuestJobNative.Image(root), rootImage));
        GuestJobNative.RequireStandardPrincipal(root, sid, session);
        foreach (var member in original) member.Check();
    }
    private Member Discover()
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < 3000)
        {
            OriginalLive(); var members = Census(); Member found = null; int nodes = 0, helpers = 0;
            try
            {
                foreach (var member in members)
                {
                    if (Same(member.Image, helper)) { found = member; helpers++; }
                    else if (Same(member.Image, rootImage)) { if (member.Pid != rootPid) nodes++; }
                    else Need(Same(member.Image, Path.Combine(Environment.SystemDirectory, "conhost.exe")));
                }
                Need(helpers <= 1 && nodes <= 1);
                if (found != null)
                {
                    Need(!original.Exists(delegate(Member member) { return member.Pid == found.Pid; }));
                    observed.AddRange(members); members.Clear(); OriginalLive(); return found;
                }
            }
            finally { foreach (var member in members) member.Dispose(); }
            Thread.Sleep(2);
        }
        throw new InvalidOperationException("guest-stdio-helper-unavailable");
    }
    private static byte[] Pattern(int count, byte value)
    { var result = new byte[count]; for (int at = 0; at < count; at++) result[at] = value; return result; }
    private static byte[] Input()
    { var result = new byte[8192]; for (int at = 0; at < result.Length; at++) result[at] = (byte)at; return result; }
    private static bool Equal(byte[] a, byte[] b)
    { if (a.Length != b.Length) return false; for (int at = 0; at < a.Length; at++) if (a[at] != b[at]) return false; return true; }
    private Member RetainCancellationPayload(out int memberCount)
    {
        memberCount = 0;
        OriginalLive(); var live = Census(); Member payload = null; int payloads = 0;
        try
        {
            foreach (var held in live)
            {
                Need(Same(held.Image, rootImage) || Same(held.Image, helper) || Same(held.Image, Path.Combine(Environment.SystemDirectory, "conhost.exe")));
                if (Same(held.Image, rootImage) && held.Pid != rootPid) { payload = held; payloads++; }
            }
            Need(payloads == 1); memberCount = live.Count; observed.AddRange(live); live.Clear(); return payload;
        }
        finally { foreach (var held in live) held.Dispose(); }
    }
    public void Execute(Dictionary<string, object> receipt)
    {
        Need(captured && !executed); executed = true;
        Member member = Discover(); transport.Attach(member.Handle, job, helper); member.Check(); OriginalLive();
        receipt["stdioHelperPid"] = member.Pid; receipt["stdioHelperBirthFileTime"] = member.Birth; receipt["stdioHelperIdentityVerified"] = true;
        receipt["stdioOriginalMemberCount"] = original.Count; receipt["stdioObservedMemberCount"] = observed.Count;
        using (var cancellation = new CancellationTokenSource())
        {
            bool cancellationArmed = false;
            Action<byte[]> readiness = null;
            if (kind == 5) readiness = delegate(byte[] bytes)
            {
                if (cancellationArmed || bytes.Length == 0) return;
                // The fixed payload emits one byte only after installing its stdin handlers and an event-loop turn.
                Need(bytes.Length == 1 && bytes[0] == 82); OriginalLive(); member.Check();
                int memberCount; Member payload = RetainCancellationPayload(out memberCount); payload.Check();
                receipt["stdioCancellationReadyPayloadPid"] = payload.Pid;
                receipt["stdioCancellationReadyPayloadBirthFileTime"] = payload.Birth;
                receipt["stdioCancellationReadyPayloadImage"] = payload.Image;
                receipt["stdioCancellationReadyPayloadSid"] = GuestJobNative.Principal(payload.Handle);
                receipt["stdioCancellationReadyPayloadSession"] = GuestJobNative.Session(payload.Handle);
                receipt["stdioCancellationReadyMemberCount"] = memberCount;
                receipt["stdioCancellationReadyPayloadIdentityVerified"] = true;
                receipt["stdioCancellationPayloadReadyBeforeTimer"] = true;
                cancellation.CancelAfter(250); cancellationArmed = true;
            };
            var result = transport.Exchange(Input(), kind == 3 ? 1024 : 65536, kind == 4 ? 1024 : 65536, 5000, cancellation.Token, readiness);
            receipt["stdioCase"] = kind; receipt["stdioOutcome"] = result.Outcome.ToString();
            receipt["stdioInputBytes"] = result.InputBytes; receipt["stdioOutputBytes"] = result.Output.Length; receipt["stdioErrorBytes"] = result.Error.Length;
            receipt["stdioInputEof"] = result.InputEof; receipt["stdioOutputEof"] = result.OutputEof; receipt["stdioErrorEof"] = result.ErrorEof;
            bool positive = false;
            if (kind == 1) positive = result.Outcome == CloudGuestStdio.Outcome.Complete && Equal(result.Output, Input()) && Equal(result.Error, Input());
            if (kind == 2)
            {
                var expected = new byte[56192]; Buffer.BlockCopy(Pattern(48000, 79), 0, expected, 0, 48000); Buffer.BlockCopy(Input(), 0, expected, 48000, 8192);
                positive = result.Outcome == CloudGuestStdio.Outcome.Complete && Equal(result.Output, expected) && Equal(result.Error, Pattern(48000, 69));
            }
            if (kind <= 2) positive &= result.InputBytes == 8192 && result.InputEof && result.OutputEof && result.ErrorEof;
            if (kind == 3 || kind == 4) positive = result.Outcome == CloudGuestStdio.Outcome.OutputLimit && result.Output.Length <= (kind == 3 ? 1024 : 65536) && result.Error.Length <= (kind == 4 ? 1024 : 65536);
            if (kind == 5)
            {
                OriginalLive(); member.Check();
                // Re-census after the cancellation signal: keep the actual live payload and all members held through closure.
                var live = Census(); int payloads = 0;
                try
                {
                    foreach (var held in live) { Need(Same(held.Image, rootImage) || Same(held.Image, helper) || Same(held.Image, Path.Combine(Environment.SystemDirectory, "conhost.exe"))); if (Same(held.Image, rootImage) && held.Pid != rootPid) payloads++; }
                    Need(payloads == 1); observed.AddRange(live); live.Clear();
                }
                finally { foreach (var held in live) held.Dispose(); }
                receipt["stdioCancellationHeldPayloadAlive"] = true;
                positive = cancellationArmed && result.Outcome == CloudGuestStdio.Outcome.Cancelled;
            }
            if (kind <= 2)
            {
                Need(GuestJobNative.WaitForSingleObject(root, 2000) == 0);
                uint exit; Need(GetExitCodeProcess(root, out exit) && exit == 0);
                receipt["stdioNaturalRootExitObserved"] = true;
            }
            else { OriginalLive(); receipt["stdioRootLiveBeforeTermination"] = true; }
            receipt["stdioBytesMatched"] = kind <= 2 && positive;
            exchangePassed = positive; Need(positive);
        }
    }
    public void ObserveClosure(bool confirmed, Dictionary<string, object> receipt, Stopwatch ownerClosureClock)
    {
        var waits = new List<Dictionary<string, object>>();
        receipt["stdioClosureMemberWaits"] = waits;
        bool exited = confirmed && ObserveMemberClosure(ownerClosureClock, waits);
        receipt["stdioClosureElapsedMilliseconds"] = ownerClosureClock == null ? (object)null : ownerClosureClock.ElapsedMilliseconds;
        receipt["stdioRetainedMembersExitObserved"] = exited;
        receipt["stdioPassed"] = executed && exchangePassed && exited;
    }
    private bool ObserveMemberClosure(Stopwatch ownerClock, List<Dictionary<string, object>> waits)
    {
        Need(ownerClock != null && ownerClock.IsRunning);
        var held = new List<Member>(original); held.AddRange(observed);
        for (int at = 0; at < held.Count; at++)
        {
            Member member = held[at];
            waits.Add(new Dictionary<string, object> { { "source", at < original.Count ? "original" : "observed" },
                { "pid", member.Pid }, { "birthFileTime", member.Birth }, { "liveImage", member.Image },
                { "waitCode", null }, { "waitWin32Error", null } });
        }
        // The owner starts this same clock at Job termination. A Job-empty census
        // can precede signaling of a later retained member; it never replaces exit proof.
        while (ownerClock.ElapsedMilliseconds < 2000)
        {
            bool exited = true;
            for (int at = 0; at < held.Count; at++)
            {
                Member member = held[at];
                uint state = GuestJobNative.WaitForSingleObject(member.Handle, 0);
                int? error = state == uint.MaxValue ? (int?)Marshal.GetLastWin32Error() : null;
                waits[at]["waitCode"] = state; waits[at]["waitWin32Error"] = error;
                // Retry only a genuine nonsignaled process. A failed/unknown wait
                // permanently refuses this confirmation even if a later probe succeeds.
                if (state != 0 && state != 0x102) return false;
                exited &= state == 0;
            }
            if (exited) return ownerClock.ElapsedMilliseconds < 2000;
            long remaining = 2000 - ownerClock.ElapsedMilliseconds;
            if (remaining <= 0) break;
            Thread.Sleep((int)Math.Min(2, remaining));
        }
        return false;
    }
    private static bool Same(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("guest-stdio-phase-refused"); }
    public void Dispose()
    {
        transport.Dispose(); foreach (var member in original) member.Dispose(); foreach (var member in observed) member.Dispose();
        original.Clear(); observed.Clear(); if (root != IntPtr.Zero) GuestJobNative.CloseHandle(root); if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
        root = job = IntPtr.Zero;
    }
}
