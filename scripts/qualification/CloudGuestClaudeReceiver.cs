using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Aegis.ProtectedSession;

// Fixed lab API stub. Its independent lifetime never extends the first receiver's 18s.
internal sealed class CloudGuestClaudeReceiver : IDisposable
{
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    private static void Require(bool value, string code) { if (!value) throw new InvalidOperationException(code); }
    private readonly Process process = new Process();
    private readonly Stopwatch watch = Stopwatch.StartNew();
    private readonly MemoryStream[] output = { new MemoryStream(), new MemoryStream() };
    private readonly byte[][] buffers = { new byte[512], new byte[512] };
    private readonly Task<int>[] reads = new Task<int>[2];
    private readonly bool[] ended = new bool[2];
    private readonly Dictionary<string, object> receipt;
    private bool started;
    private const string Trusted = @"C:\ProgramData\AegisCloudLab\trusted";
    private const string Result = @"C:\ProgramData\AegisCloudLab\admin\claude-receiver-result.json";
    private static Match FixedMatch(string text, string pattern)
    {
        Require(text != null && Encoding.UTF8.GetByteCount(text) <= 8192, "claude-frame-budget");
        return Regex.Match(text, pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
    }
    private static long CanonicalNumber(string value, long maximum)
    {
        long number;
        Require(Int64.TryParse(value, out number) && number >= 0 && number <= maximum &&
            value == number.ToString(System.Globalization.CultureInfo.InvariantCulture), "claude-frame-number");
        return number;
    }
    internal static string ReadyFrame(string text)
    {
        Require(text != null && Encoding.UTF8.GetByteCount(text) <= 256, "claude-ready-budget");
        Match match = FixedMatch(text, "\\A\\{\"schemaVersion\":1,\"kind\":\"claude-ready\",\"address\":\"127\\.0\\.0\\.1\",\"port\":([0-9]{1,5}),\"nonce\":\"[a-f0-9]{32}\"\\}\\z");
        Require(match.Success && CanonicalNumber(match.Groups[1].Value, 65535) > 0, "claude-ready-shape");
        return text;
    }
    internal static void FinalFrame(string text)
    {
        // Canonical fixed producer format rejects extra/duplicate fields as well as JSON coercion.
        const string pattern = "\\A\\{\"schemaVersion\":1,\"kind\":\"claude-receiver\",\"passed\":true,\"closed\":true,\"stopObserved\":true,\"expired\":false,\"requests\":4,\"completedResponses\":4,\"toolResults\":\\[true,true,true\\],\"steps\":\\[\"read\",\"edit\",\"test\",\"finish\"\\],\"connectionCount\":([0-9]{1,2}),\"connectionClosed\":([0-9]{1,2}),\"clientEofCount\":([0-9]{1,2}),\"completedResetCount\":([0-9]{1,2}),\"forcedClosed\":0,\"elapsedMilliseconds\":([0-9]{1,5}),\"failure\":null\\}\\z";
        Match match = FixedMatch(text, pattern);
        Require(match.Success, "claude-final-shape");
        long connections = CanonicalNumber(match.Groups[1].Value, 8);
        Require(connections > 0 && CanonicalNumber(match.Groups[2].Value, 8) == connections &&
            CanonicalNumber(match.Groups[3].Value, 8) + CanonicalNumber(match.Groups[4].Value, 8) == connections && CanonicalNumber(match.Groups[5].Value, 44999) < 45000,
            "claude-final-closure");
    }
    internal static void StopFence(long before, long submitted, long exited)
    {
        Require(before >= 0 && before < 42500 && submitted >= before && submitted < 43500 &&
            exited >= submitted && exited < 45000, "claude-stop-window-expired");
    }
    private static void FreshJson(string path, string text)
    {
        byte[] bytes = new UTF8Encoding(false, true).GetBytes(text);
        Require(bytes.Length <= 8192, "claude-file-budget");
        using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) file.Write(bytes, 0, bytes.Length);
    }
    private void Pump()
    {
        for (int i = 0; i < 2; i++)
        {
            if (ended[i] || !reads[i].IsCompleted) continue;
            int count = reads[i].GetAwaiter().GetResult();
            if (count == 0) { ended[i] = true; continue; }
            Require(output[i].Length + count <= (i == 0 ? 8448 : 1024), "claude-receiver-output-budget");
            output[i].Write(buffers[i], 0, count);
            reads[i] = (i == 0 ? process.StandardOutput.BaseStream : process.StandardError.BaseStream).ReadAsync(buffers[i], 0, buffers[i].Length);
        }
    }
    internal CloudGuestClaudeReceiver(IntPtr job, Dictionary<string, object> ownerReceipt)
    {
        receipt = ownerReceipt;
        receipt["claudeReceiverForced"] = false; receipt["claudeReceiverDisposalUnknown"] = false;
        try
        {
            string image = Path.Combine(Trusted, "node.exe");
            process.StartInfo = new ProcessStartInfo(image, "\"" + Path.Combine(Trusted, "claude-receiver.cjs") + "\"");
            process.StartInfo.UseShellExecute = false; process.StartInfo.CreateNoWindow = true;
            process.StartInfo.RedirectStandardInput = true; process.StartInfo.RedirectStandardOutput = true; process.StartInfo.RedirectStandardError = true;
            process.StartInfo.WorkingDirectory = Trusted;
            process.StartInfo.EnvironmentVariables.Clear();
            process.StartInfo.EnvironmentVariables["SystemRoot"] = @"C:\Windows";
            process.StartInfo.EnvironmentVariables["TEMP"] = @"C:\AegisLab\scratch";
            process.StartInfo.EnvironmentVariables["TMP"] = @"C:\AegisLab\scratch";
            process.StartInfo.EnvironmentVariables["AEGIS_CLOUD_GUEST_CLAUDE"] = "1";
            Require(process.Start(), "claude-receiver-start"); started = true;
            IntPtr held = process.Handle; bool member;
            Require(GuestJobNative.WaitForSingleObject(held, 0) == 0x102 && GuestJobNative.Image(held).Equals(image, StringComparison.OrdinalIgnoreCase), "claude-receiver-image");
            Require(IsProcessInJob(held, job, out member) && !member, "claude-receiver-outside-job");
            IntPtr token;
            Require(OpenProcessToken(held, 8 | 2, out token), "claude-receiver-token");
            try
            {
                using (var identity = new WindowsIdentity(token))
                using (var parent = WindowsIdentity.GetCurrent())
                    Require(identity.User != null && identity.User.Equals(parent.User) && new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator), "claude-receiver-principal");
            }
            finally { GuestJobNative.CloseHandle(token); }
            receipt["claudeReceiverPid"] = process.Id; receipt["claudeReceiverBirthFileTime"] = process.StartTime.ToFileTimeUtc();
            receipt["claudeReceiverOutsideTaskJob"] = true; receipt["claudeReceiverAdministratorEnabled"] = true;
            receipt["claudeReceiverSameOwnerSid"] = true;
            reads[0] = process.StandardOutput.BaseStream.ReadAsync(buffers[0], 0, buffers[0].Length);
            reads[1] = process.StandardError.BaseStream.ReadAsync(buffers[1], 0, buffers[1].Length);
            string frame = null;
            while (watch.ElapsedMilliseconds < 1500 && !process.HasExited)
            {
                Pump(); byte[] bytes = output[0].ToArray(); int end = Array.IndexOf(bytes, (byte)10);
                if (end >= 0) { frame = new UTF8Encoding(false, true).GetString(bytes, 0, end); break; }
                System.Threading.Thread.Sleep(1);
            }
            Require(frame != null && output[1].Length == 0, "claude-ready-unconfirmed");
            FreshJson(Path.Combine(Trusted, "claude-endpoint.json"), ReadyFrame(frame));
            receipt["claudeReceiverReadyMilliseconds"] = watch.ElapsedMilliseconds;
            BeforeRelease();
        }
        catch { Dispose(); throw; }
    }
    internal void BeforeRelease()
    {
        Require(watch.ElapsedMilliseconds < 2000 && !process.HasExited, "claude-release-window-expired");
        receipt["claudeReceiverReleaseMilliseconds"] = watch.ElapsedMilliseconds;
    }
    // The retained root wait plus inventory confirmation can each take 2s.
    // Slow cases refuse; no deadline from the old calibration is changed.
    internal uint RemainingTaskWait()
    {
        long available = 38500 - watch.ElapsedMilliseconds;
        Require(available > 0, "claude-task-window-expired");
        return (uint)Math.Min(41000, available);
    }
    internal void Finish(bool jobClosure)
    {
        long before = watch.ElapsedMilliseconds;
        receipt["claudeReceiverStopMilliseconds"] = before;
        bool expired = process.HasExited || before >= 42500;
        receipt["claudeReceiverExpiredBeforeStop"] = expired;
        receipt["claudeReceiverStoppedAfterJobClosure"] = jobClosure && !expired;
        if (!expired && jobClosure)
        {
            process.StandardInput.Write("STOP\n"); process.StandardInput.Close();
            long submitted = watch.ElapsedMilliseconds;
            receipt["claudeReceiverStopSubmittedMilliseconds"] = submitted;
            Require(submitted >= before && submitted < 43500, "claude-stop-window-expired");
        }
        else if (!process.HasExited) { receipt["claudeReceiverForced"] = true; process.Kill(); }
        var closing = Stopwatch.StartNew();
        while (closing.ElapsedMilliseconds < 2500 && watch.ElapsedMilliseconds < 45000 && (!process.HasExited || !ended[0] || !ended[1]))
        { Pump(); System.Threading.Thread.Sleep(1); }
        Pump(); bool exited = process.HasExited;
        receipt["claudeReceiverExitObserved"] = exited; receipt["claudeReceiverExitMilliseconds"] = watch.ElapsedMilliseconds;
        if (exited) receipt["claudeReceiverExitCode"] = process.ExitCode;
        Require(!expired && jobClosure && exited && ended[0] && ended[1] && output[1].Length == 0 && process.ExitCode == 0, "claude-receiver-closure-unconfirmed");
        StopFence(before, (long)receipt["claudeReceiverStopSubmittedMilliseconds"], watch.ElapsedMilliseconds);
        string[] frames = new UTF8Encoding(false, true).GetString(output[0].ToArray()).Split('\n');
        Require(frames.Length == 3 && frames[2] == "", "claude-final-framing");
        ReadyFrame(frames[0]); FinalFrame(frames[1]); FreshJson(Result, frames[1]); receipt["claudeReceiverResultWritten"] = true;
    }
    public void Dispose()
    {
        if (started)
            try { if (!process.HasExited) { receipt["claudeReceiverForced"] = true; process.Kill(); if (!process.WaitForExit(1000)) receipt["claudeReceiverDisposalUnknown"] = true; } }
            catch { receipt["claudeReceiverDisposalUnknown"] = true; }
        process.Dispose(); foreach (MemoryStream stream in output) stream.Dispose();
    }
}
