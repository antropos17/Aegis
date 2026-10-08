using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Separate post-Claude verifier. No authority over the original Claude tool process.
public static class CloudGuestTestWitness
{
    private const string Trusted = @"C:\ProgramData\AegisCloudLab\trusted";
    private const string Source = @"C:\AegisLab\work\claude\sum.cjs";
    private const string Edited = "module.exports = (a, b) => a + b;\n";
    [StructLayout(LayoutKind.Sequential)] private struct FileInfo
    {
        internal uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
        internal uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo value);
    private sealed class Pin : IDisposable
    {
        internal readonly FileStream File;
        private readonly string path;
        private readonly FileInfo initial;
        internal Pin(string selected, string expectedHash, long maximum)
        {
            path = selected; FileStream opened = null;
            try {
                for (string at = path; at != null; at = Path.GetDirectoryName(at))
                    Need((System.IO.File.GetAttributes(at) & FileAttributes.ReparsePoint) == 0);
                opened = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                Need(GetFileInformationByHandle(opened.SafeFileHandle, out initial));
                Need(initial.Links == 1 && (initial.Attributes & 0x410) == 0 && opened.Length <= maximum);
                if (expectedHash != null) {
                    Need(System.Text.RegularExpressions.Regex.IsMatch(expectedHash, "\\A[a-f0-9]{64}\\z"));
                    using (var hash = SHA256.Create())
                        Need(BitConverter.ToString(hash.ComputeHash(opened)).Replace("-", "").ToLowerInvariant() == expectedHash);
                }
                opened.Position = 0; File = opened; opened = null;
            } finally { if (opened != null) opened.Dispose(); }
        }
        internal void Recheck()
        {
            FileInfo held, named;
            Need(GetFileInformationByHandle(File.SafeFileHandle, out held));
            using (var other = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                Need(GetFileInformationByHandle(other.SafeFileHandle, out named));
            Need(Same(initial, held) && Same(initial, named));
        }
        public void Dispose() { File.Dispose(); }
    }
    private static bool Same(FileInfo a, FileInfo b)
    {
        return a.Volume == b.Volume && a.IndexHigh == b.IndexHigh && a.IndexLow == b.IndexLow &&
            a.SizeHigh == b.SizeHigh && a.SizeLow == b.SizeLow && a.WriteHigh == b.WriteHigh &&
            a.WriteLow == b.WriteLow && b.Links == 1 && (b.Attributes & 0x410) == 0;
    }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("fixed-witness-refused"); }
    private static void ExactEdited(Pin source)
    {
        source.File.Position = 0; byte[] bytes = new byte[257]; int count = 0, read;
        while (count < bytes.Length && (read = source.File.Read(bytes, count, bytes.Length - count)) != 0) count += read;
        Need(count <= 256 && new UTF8Encoding(false, true).GetString(bytes, 0, count) == Edited);
    }
    private static bool Boolean(Dictionary<string, object> value, string key, bool expected)
    { object actual; return value.TryGetValue(key, out actual) && actual is bool && (bool)actual == expected; }
    private static bool Number(Dictionary<string, object> value, string key, long minimum, long maximum)
    {
        object raw;
        if (!value.TryGetValue(key, out raw) || !(raw is uint || raw is int || raw is long)) return false;
        long actual = Convert.ToInt64(raw); return actual >= minimum && actual <= maximum;
    }
    internal static bool Validate(Dictionary<string, object> receipt, string expectedSid)
    {
        object kind, sid, stage;
        if (!receipt.TryGetValue("verificationKind", out kind) || !(kind is string) ||
            (string)kind != "separate-post-claude-fixed-standard-user-process" ||
            !receipt.TryGetValue("sid", out sid) || !(sid is string) || (string)sid != expectedSid ||
            !receipt.TryGetValue("failureStage", out stage) || stage != null) return false;
        foreach (string key in new string[] { "passed", "heldIdentityBeforeRelease", "runtimeResumed", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "taskReleased",
            "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopHandlesClosedAfterJobClosure", "exitCodeObserved", "naturalExitObservedBeforeJobTermination", "jobClosureConfirmed",
            "witnessInputPinsVerified", "witnessEditedBytesVerified", "witnessInputsHeldThroughConfirmedClosure", "witnessInputHandlesClosed" })
            if (!Boolean(receipt, key, true)) return false;
        foreach (string key in new string[] { "originalClaudeToolProcessObserved", "witnessInputDisposalUnknown", "elevated", "administratorEnabled", "administratorGroupPresent", "acceptancePassed", "e6Qualified", "launchAllowed" })
            if (!Boolean(receipt, key, false)) return false;
        return Number(receipt, "exitCode", 0, 0) && Number(receipt, "pid", 1, uint.MaxValue) &&
            Number(receipt, "birthFileTime", 1, long.MaxValue) && Number(receipt, "initialJobMembers", 1, 64) && Number(receipt, "tokenRequestedAccess", 8, 8);
    }
    // Hashes come only from the independently checked admin-owned fixed manifest.
    public static Dictionary<string, object> Run(string password, string expectedSid, string nodeHash, string runtimeHash, string testHash)
    {
        var pins = new List<Pin>(); Dictionary<string, object> receipt = null;
        bool inputVerified = false, editedVerified = false, closure = false, closed = true;
        try {
            Need(nodeHash != null && runtimeHash != null && testHash != null);
            pins.Add(new Pin(Path.Combine(Trusted, "node.exe"), nodeHash, 256 * 1024 * 1024));
            pins.Add(new Pin(Path.Combine(Trusted, "claude-test-witness-runtime.cjs"), runtimeHash, 65536));
            pins.Add(new Pin(Path.Combine(Trusted, "claude-test-witness.cjs"), testHash, 65536));
            pins.Add(new Pin(Source, null, 256)); ExactEdited(pins[3]); inputVerified = true;
            receipt = CloudGuestProcess.RunTestWitness(password, expectedSid);
            closure = Boolean(receipt, "jobClosureConfirmed", true);
            foreach (Pin pin in pins) pin.Recheck(); ExactEdited(pins[3]); editedVerified = true;
        } catch (Exception error) {
            receipt = CloudGuestProcess.FailureReceipt(error) ?? receipt ?? new Dictionary<string, object>();
            closure = Boolean(receipt, "jobClosureConfirmed", true);
            receipt["passed"] = false;
            if (!receipt.ContainsKey("failureStage") || receipt["failureStage"] == null) receipt["failureStage"] = "witness-input-or-result-refused";
            receipt["witnessFailureHResult"] = error.HResult;
        } finally {
            foreach (Pin pin in pins) { try { pin.Dispose(); } catch { closed = false; } }
        }
        receipt["witnessInputPinsVerified"] = inputVerified; receipt["witnessEditedBytesVerified"] = editedVerified;
        receipt["witnessInputsHeldThroughConfirmedClosure"] = inputVerified && closure;
        receipt["witnessInputHandlesClosed"] = closed; receipt["witnessInputDisposalUnknown"] = !closure || !closed;
        receipt["acceptancePassed"] = false; receipt["e6Qualified"] = false; receipt["launchAllowed"] = false;
        receipt["passed"] = Validate(receipt, expectedSid);
        receipt["trustedTestProcessObservation"] = (bool)receipt["passed"] ? "observed-separate-post-claude-fixed-test" : "unknown";
        return receipt;
    }
}
