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

// Only Run constructs this fixed trusted receiver; there is no arbitrary launcher surface.
internal sealed class CloudGuestNetwork : IDisposable
{
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    private static void Require(bool value, string stage) { if (!value) throw new InvalidOperationException(stage); }
    private static IntPtr OpenHeldToken(IntPtr heldProcess)
    {
        IntPtr token;
        // Framework primary-token membership requires QUERY and DUPLICATE; no privilege adjustment.
        Require(OpenProcessToken(heldProcess, 8 | 2, out token), "network-receiver-token");
        return token;
    }
    private readonly Process process = new Process();
    private readonly Stopwatch watch = Stopwatch.StartNew();
    private readonly MemoryStream[] output = { new MemoryStream(), new MemoryStream() };
    private readonly byte[][] buffers = { new byte[1024], new byte[1024] };
    private readonly Task<int>[] reads = new Task<int>[2];
    private readonly bool[] ended = new bool[2];
    private readonly Dictionary<string, object> receipt;
    private readonly string resultPath;
    private bool started;
    private void Pump()
    {
        for (int i = 0; i < 2; i++)
        {
            if (ended[i] || !reads[i].IsCompleted) continue;
            int count = reads[i].GetAwaiter().GetResult();
            if (count == 0) { ended[i] = true; continue; }
            Require(output[i].Length + count <= (i == 0 ? 10240 : 1024), "network-receiver-output-budget");
            output[i].Write(buffers[i], 0, count);
            reads[i] = (i == 0 ? process.StandardOutput.BaseStream : process.StandardError.BaseStream).ReadAsync(buffers[i], 0, buffers[i].Length);
        }
    }
    private static string Endpoint(string frame)
    {
        const string pattern = "\\A\\{\"type\":\"ready\",\"endpoint\":\\{\"schemaVersion\":1,\"nonce\":\"[a-f0-9]{32}\",\"ports\":\\{\"tcp4\":([0-9]{1,5}),\"udp4\":([0-9]{1,5}),\"tcp6\":([0-9]{1,5}),\"udp6\":([0-9]{1,5})\\}\\}\\}\\z";
        Require(frame.Length <= 2048, "network-readiness-budget");
        Match match = Regex.Match(frame, pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        Require(match.Success, "network-readiness-shape");
        for (int i = 1; i <= 4; i++)
        {
            int port; Require(Int32.TryParse(match.Groups[i].Value, out port) && port > 0 && port <= 65535, "network-readiness-port");
            Require(match.Groups[i].Value == port.ToString(System.Globalization.CultureInfo.InvariantCulture), "network-readiness-canonical");
        }
        const string prefix = "{\"type\":\"ready\",\"endpoint\":";
        return frame.Substring(prefix.Length, frame.Length - prefix.Length - 1);
    }
    private static void FreshJson(string path, string text)
    {
        byte[] bytes = new UTF8Encoding(false, true).GetBytes(text);
        Require(bytes.Length <= 8192, "network-file-budget");
        using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
        {
            file.Write(bytes, 0, bytes.Length);
        }
    }
    internal CloudGuestNetwork(IntPtr job, Dictionary<string, object> ownerReceipt)
    {
        const string trusted = @"C:\ProgramData\AegisCloudLab\trusted";
        string image = Path.Combine(trusted, "node.exe");
        receipt = ownerReceipt; resultPath = @"C:\ProgramData\AegisCloudLab\admin\network-receiver-result.json";
        try
        {
            process.StartInfo = new ProcessStartInfo(image, "\"" + Path.Combine(trusted, "receiver.cjs") + "\"");
            process.StartInfo.UseShellExecute = false; process.StartInfo.CreateNoWindow = true;
            process.StartInfo.RedirectStandardInput = true; process.StartInfo.RedirectStandardOutput = true; process.StartInfo.RedirectStandardError = true;
            process.StartInfo.WorkingDirectory = trusted;
            Require(process.Start(), "network-receiver-start"); started = true;
            IntPtr held = process.Handle; bool member;
            Require(GuestJobNative.WaitForSingleObject(held, 0) == 0x102 && GuestJobNative.Image(held).Equals(image, StringComparison.OrdinalIgnoreCase), "network-receiver-image");
            Require(IsProcessInJob(held, job, out member) && !member, "network-receiver-outside-job");
            IntPtr receiverToken = OpenHeldToken(held);
            try
            {
                using (var identity = new WindowsIdentity(receiverToken))
                using (var parent = WindowsIdentity.GetCurrent())
                    Require(identity.User != null && identity.User.Equals(parent.User) && new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator), "network-receiver-principal");
            }
            finally { GuestJobNative.CloseHandle(receiverToken); }
            receipt["networkReceiverPid"] = process.Id; receipt["networkReceiverBirthFileTime"] = process.StartTime.ToFileTimeUtc();
            receipt["networkReceiverOutsideTaskJob"] = true; receipt["networkReceiverStartedAfterHeldAdmission"] = true;
            receipt["networkReceiverAdministratorEnabled"] = true; receipt["networkReceiverSameOwnerSid"] = true;
            receipt["networkReceiverForced"] = false; receipt["networkReceiverDisposalUnknown"] = false;
            reads[0] = process.StandardOutput.BaseStream.ReadAsync(buffers[0], 0, buffers[0].Length);
            reads[1] = process.StandardError.BaseStream.ReadAsync(buffers[1], 0, buffers[1].Length);
            string frame = null;
            while (watch.ElapsedMilliseconds < 1000 && !process.HasExited)
            {
                Pump(); byte[] bytes = output[0].ToArray(); int end = Array.IndexOf(bytes, (byte)10);
                if (end >= 0) { frame = new UTF8Encoding(false, true).GetString(bytes, 0, end); break; }
                System.Threading.Thread.Sleep(1);
            }
            Require(frame != null && output[1].Length == 0, "network-readiness-unconfirmed");
            FreshJson(Path.Combine(trusted, "network-endpoint.json"), Endpoint(frame));
            Require(watch.ElapsedMilliseconds <= 1500 && !process.HasExited, "network-release-window-expired");
            receipt["networkReceiverReadyMilliseconds"] = watch.ElapsedMilliseconds;
        }
        catch { Dispose(); throw; }
    }
    internal void BeforeRelease()
    {
        Require(watch.ElapsedMilliseconds <= 1500 && !process.HasExited, "network-release-window-expired");
        receipt["networkReceiverReleaseMilliseconds"] = watch.ElapsedMilliseconds;
    }
    private static void StopWindow(long before, long after)
    {
        Require(before >= 0 && before < 17500 && after >= before && after < 17500, "network-stop-window-expired");
    }
    internal void Finish(bool jobClosure)
    {
        receipt["networkReceiverStopMilliseconds"] = watch.ElapsedMilliseconds;
        // The unchanged receiver expires at 18s. This earlier owner deadline
        // includes spawn time and refuses to infer success from an expiry close.
        bool expired = process.HasExited || watch.ElapsedMilliseconds >= 17500;
        receipt["networkReceiverExpiredBeforeStop"] = expired;
        receipt["networkReceiverStoppedAfterJobClosure"] = jobClosure && !expired;
        if (!expired && jobClosure)
        {
            process.StandardInput.Write("stop\n"); process.StandardInput.Close();
            long submitted = watch.ElapsedMilliseconds;
            receipt["networkReceiverStopSubmittedMilliseconds"] = submitted;
            // Submission itself must fit the fence: a scheduling pause cannot
            // turn the receiver's automatic expiry into an owner-directed stop.
            if (submitted >= 17500) { receipt["networkReceiverExpiredBeforeStop"] = true; receipt["networkReceiverStoppedAfterJobClosure"] = false; }
            StopWindow((long)receipt["networkReceiverStopMilliseconds"], submitted);
        }
        else if (!process.HasExited) { receipt["networkReceiverForced"] = true; process.Kill(); }
        var closing = Stopwatch.StartNew();
        while (closing.ElapsedMilliseconds < 2500 && (!process.HasExited || !ended[0] || !ended[1])) { Pump(); System.Threading.Thread.Sleep(1); }
        Pump();
        bool exited = process.HasExited;
        receipt["networkReceiverExitObserved"] = exited;
        receipt["networkReceiverExitMilliseconds"] = watch.ElapsedMilliseconds;
        if (exited) receipt["networkReceiverExitCode"] = process.ExitCode;
        Require(exited && ended[0] && ended[1] && output[1].Length == 0, "network-receiver-closure-unconfirmed");
        string[] frames = new UTF8Encoding(false, true).GetString(output[0].ToArray()).Split('\n');
        Require(frames.Length == 3 && frames[2] == "" && frames[1].Length > 0, "network-receiver-final-frame");
        FreshJson(resultPath, frames[1]); receipt["networkReceiverResultWritten"] = true;
        Require(!expired && jobClosure && process.ExitCode == 0 && watch.ElapsedMilliseconds < 18000, "network-receiver-expired-or-refused");
    }
    public void Dispose()
    {
        if (started)
        {
            try { if (!process.HasExited) { receipt["networkReceiverForced"] = true; process.Kill(); if (!process.WaitForExit(1000)) receipt["networkReceiverDisposalUnknown"] = true; } } catch { receipt["networkReceiverDisposalUnknown"] = true; }
        }
        process.Dispose(); foreach (MemoryStream stream in output) stream.Dispose();
    }
}
