using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // This observation never returns enrollment authority or a lifecycle owner.
    internal sealed class EnrollmentInspection
    {
        internal readonly bool Observed;
        internal readonly string Phase, Reason;
        private EnrollmentInspection(bool observed, string phase, string reason)
        { Observed = observed; Phase = phase; Reason = reason; }
        internal string Json()
        {
            return "{\"schemaVersion\":1,\"scope\":\"protected-enrollment-inspection\",\"observed\":" +
                (Observed ? "true" : "false") + ",\"phase\":\"" + Phase + "\",\"reason\":\"" + Reason +
                "\",\"ownershipQualified\":false,\"callerQualified\":false,\"launchAllowed\":false}";
        }
        internal static EnrollmentInspection InspectInstalled()
        {
            try {
                string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "AEGIS", "ProtectedSession");
                return Inspect(root, Assembly.GetExecutingAssembly().Location, new EnrollmentNative());
            }
            catch { return new EnrollmentInspection(false, "root", "enrollment-unavailable"); }
        }
        private static readonly Regex Record = new Regex(
            "\\A\\{\"schemaVersion\":1,\"installId\":\"([a-f0-9]{32})\",\"revision\":([1-9][0-9]{0,9})," +
            "\"epoch\":\"([a-f0-9]{32})\",\"rootVolumeSerial\":\"([a-f0-9]{16})\"," +
            "\"rootFileId\":\"([a-f0-9]{32})\",\"supervisorSha256\":\"([a-f0-9]{64})\"," +
            "\"status\":\"(active|revoked)\"\\}\\z", RegexOptions.CultureInvariant);
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static bool Hex(string text, int length)
        { return text != null && text.Length == length && Regex.IsMatch(text, "\\A[a-f0-9]+\\z"); }
        internal static void Check(EnrollmentHeld file, string path, bool directory, bool ancestor)
        {
            EnrollmentNative.Require(file != null && file.Directory == directory && !file.Reparse &&
                String.Equals(file.PathName, path, StringComparison.OrdinalIgnoreCase) &&
                Hex(file.Volume, 16) && Hex(file.FileId, 32) && file.Volume != new string('0', 16) &&
                file.FileId != new string('0', 32) && file.Protected(ancestor));
        }
        // Internal disposable-observation seam, never selected by Program inputs.
        internal static EnrollmentInspection Inspect(string root, string runningImage, IEnrollmentFiles files)
        { return InspectCore(root, runningImage, files, null); }
        // Transfers actual held objects only after the complete observation;
        // the ordinary inspection still closes every object before returning.
        internal sealed class RetainedFiles
        {
            internal readonly List<EnrollmentHeld> Objects = new List<EnrollmentHeld>();
            internal byte[] RecordBytes;
            internal int ImageSize;
            internal string ImageHash;
            internal Identity Selected;
        }
        // Immutable provenance is issued only with the retained native observation.
        internal sealed class Identity
        {
            internal readonly string Root, InstallId, Epoch;
            internal readonly uint Revision;
            internal Identity(string root, string installId, uint revision, string epoch)
            { Root = root; InstallId = installId; Revision = revision; Epoch = epoch; }
        }
        internal static RetainedFiles RetainFiles(string root, string runningImage, IEnrollmentFiles files)
        {
            var retained = new RetainedFiles();
            EnrollmentInspection result = InspectCore(root, runningImage, files, retained);
            EnrollmentNative.Require(result.Observed && retained.Objects.Count >= 3 && retained.Objects.Count <= 34);
            return retained;
        }
        private static EnrollmentInspection InspectCore(string root, string runningImage,
            IEnrollmentFiles files, RetainedFiles retained)
        {
            var held = new List<EnrollmentHeld>(); string phase = "root";
            var watch = Stopwatch.StartNew(); EnrollmentInspection result;
            try {
                EnrollmentNative.Require(files != null && !String.IsNullOrEmpty(root) &&
                    Path.IsPathRooted(root) && !root.StartsWith("\\\\", StringComparison.Ordinal) &&
                    root.IndexOf(':', 2) < 0 && root.Length <= 2048 &&
                    String.Equals(Path.GetFullPath(root), root, StringComparison.OrdinalIgnoreCase));
                var ancestors = new List<string>(); string cursor = root;
                while (cursor != null) {
                    ancestors.Add(cursor); EnrollmentNative.Require(ancestors.Count <= 32);
                    cursor = Path.GetDirectoryName(cursor);
                }
                // Open/pin from the volume down so no descendant is accepted
                // through an unobserved ancestor's reparse point.
                ancestors.Reverse(); EnrollmentHeld rootHeld = null;
                foreach (string path in ancestors) {
                    EnrollmentHeld file = files.Open(path, true); held.Add(file);
                    Check(file, path, true, !String.Equals(path, root, StringComparison.OrdinalIgnoreCase));
                    rootHeld = file; Deadline(watch);
                }
                phase = "record";
                string recordPath = Path.Combine(root, "enrollment.json");
                EnrollmentHeld record = files.Open(recordPath, false); held.Add(record);
                Check(record, recordPath, false, false); byte[] bytes = record.Read(1024);
                EnrollmentNative.Require(bytes != null && bytes.Length > 0 && bytes.Length <= 1024);
                Match match = Record.Match(Utf8.GetString(bytes)); uint revision = 0;
                EnrollmentNative.Require(match.Success && UInt32.TryParse(match.Groups[2].Value, out revision) &&
                    revision > 0 && match.Groups[4].Value == rootHeld.Volume && match.Groups[5].Value == rootHeld.FileId);
                Deadline(watch);
                if (match.Groups[7].Value != "active") {
                    result = new EnrollmentInspection(false, "record", "enrollment-revoked");
                } else {
                    phase = "image"; string imagePath = Path.Combine(root, "aegis-session.exe");
                    EnrollmentNative.Require(String.Equals(imagePath, Path.GetFullPath(runningImage), StringComparison.OrdinalIgnoreCase));
                    EnrollmentHeld image = files.Open(imagePath, false); held.Add(image);
                    Check(image, imagePath, false, false); byte[] imageBytes = image.Read(4 * 1024 * 1024);
                    string digest = ImageHash(imageBytes);
                    Array.Clear(imageBytes, 0, imageBytes.Length);
                    EnrollmentNative.Require(digest == match.Groups[6].Value);
                    phase = "recheck";
                    for (int index = 0; index < held.Count; index++) {
                        held[index].Recheck(index < held.Count - 3); Deadline(watch);
                    }
                    if (retained != null) {
                        retained.RecordBytes = (byte[])bytes.Clone();
                        retained.ImageSize = imageBytes.Length; retained.ImageHash = digest;
                        retained.Selected = new Identity(root, match.Groups[1].Value, revision, match.Groups[3].Value);
                    }
                    result = new EnrollmentInspection(true, "complete", "protected-enrollment-observed");
                }
            }
            catch { result = new EnrollmentInspection(false, phase, "enrollment-unavailable"); }
            finally { watch.Stop(); }
            if (result.Observed && retained != null) { retained.Objects.AddRange(held); return result; }
            bool closed = true;
            for (int index = held.Count - 1; index >= 0; index--)
                try { held[index].Dispose(); } catch { closed = false; }
            return closed ? result : new EnrollmentInspection(false, "close", "enrollment-unavailable");
        }
        // Synchronous OS calls are not cancelled by this post-call budget check.
        // A caller requiring a hard wall-clock limit must supervise the process.
        private static void Deadline(Stopwatch watch) { EnrollmentNative.Require(watch.ElapsedMilliseconds < 2000); }
        // Shared identical bounded digest for inspection and the retained lease recheck.
        internal static string ImageHash(byte[] bytes)
        {
            EnrollmentNative.Require(bytes != null && bytes.Length > 0 && bytes.Length <= 4 * 1024 * 1024);
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
    }
}
