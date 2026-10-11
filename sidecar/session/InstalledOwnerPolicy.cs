using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Only the fixed protected installation supplies this policy. No wire root selector exists.
    internal sealed class InstalledOwnerPolicy : IDisposable
    {
        internal const string ServiceName = "AegisProtectedSessionOwner";
        internal static string Root { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AEGIS", "ProtectedSession"); } }
        internal static string Receipts { get { return Path.Combine(Path.GetDirectoryName(Root), "Receipts"); } }
        internal readonly string InstallId, Epoch, OperatorSid, OperatorAccount, SelectionId, SelectionEpoch;
        internal readonly uint Revision;
        internal readonly int OwnerSize, SupervisorSize, MainSize;
        internal readonly string OwnerHash, SupervisorHash, MainHash;
        internal readonly string Digest;
        private readonly List<EnrollmentHeld> held = new List<EnrollmentHeld>();
        private readonly byte[] record;
        private bool closed;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly Regex Schema = new Regex("\\A\\{\"schemaVersion\":1,\"installId\":\"([a-f0-9]{32})\",\"revision\":([1-9][0-9]{0,9}),\"epoch\":\"([a-f0-9]{32})\"," +
            "\"rootVolumeSerial\":\"([a-f0-9]{16})\",\"rootFileId\":\"([a-f0-9]{32})\"," +
            "\"ownerImageSize\":([1-9][0-9]{0,8}),\"ownerImageSha256\":\"([a-f0-9]{64})\"," +
            "\"supervisorImageSize\":([1-9][0-9]{0,8}),\"supervisorImageSha256\":\"([a-f0-9]{64})\"," +
            "\"mainImageSize\":([1-9][0-9]{0,8}),\"mainImageSha256\":\"([a-f0-9]{64})\"," +
            "\"operatorSid\":\"(S-1-(?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){1,15})\",\"operatorAccount\":\"([A-Za-z][A-Za-z0-9_-]{0,31})\"," +
            "\"selectionId\":\"([a-f0-9]{32})\",\"selectionEpoch\":\"([a-f0-9]{32})\",\"status\":\"active\"\\}\\z", RegexOptions.CultureInvariant);
        private InstalledOwnerPolicy()
        {
            try
            {
                var files = new EnrollmentNative(); var ancestors = new List<string>();
                string cursor = Root;
                while (cursor != null) { ancestors.Add(cursor); CallerNative.Require(ancestors.Count <= 32); cursor = Path.GetDirectoryName(cursor); }
                ancestors.Reverse();
                foreach (string path in ancestors)
                {
                    EnrollmentHeld item = files.Open(path, true); held.Add(item);
                    EnrollmentInspection.Check(item, path, true, path != Root);
                }
                EnrollmentHeld root = held[held.Count - 1]; string policyPath = Path.Combine(Root, "owner-policy.json");
                EnrollmentHeld policy = files.Open(policyPath, false); held.Add(policy);
                EnrollmentInspection.Check(policy, policyPath, false, false); record = policy.Read(4096);
                Digest = EnrollmentInspection.ImageHash(record);
                Match match = Schema.Match(Utf8.GetString(record));
                CallerNative.Require(match.Success && match.Groups[4].Value == root.Volume && match.Groups[5].Value == root.FileId);
                InstallId = match.Groups[1].Value; Epoch = match.Groups[3].Value;
                CallerNative.Require(UInt32.TryParse(match.Groups[2].Value, out Revision));
                OwnerSize = Size(match.Groups[6].Value); OwnerHash = match.Groups[7].Value;
                SupervisorSize = Size(match.Groups[8].Value); SupervisorHash = match.Groups[9].Value;
                MainSize = Size(match.Groups[10].Value); MainHash = match.Groups[11].Value;
                OperatorSid = match.Groups[12].Value; OperatorAccount = match.Groups[13].Value;
                SelectionId = match.Groups[14].Value; SelectionEpoch = match.Groups[15].Value;
                CallerNative.Require(OperatorSid != "S-1-5-18" && OperatorSid != "S-1-5-32-544"); CheckCurrent();
            }
            catch { Dispose(); throw; }
        }
        internal static InstalledOwnerPolicy Acquire() { return new InstalledOwnerPolicy(); }
        private static int Size(string text) { int size; CallerNative.Require(Int32.TryParse(text, out size) && size > 0 && size <= 4 * 1024 * 1024); return size; }
        internal void CheckCurrent()
        {
            CallerNative.Require(!closed && !CallerNative.HasThreadToken());
            for (int index = 0; index < held.Count; index++) held[index].Recheck(index < held.Count - 2);
            byte[] current = held[held.Count - 1].Read(4096);
            try { CallerNative.Require(current.Length == record.Length); for (int index = 0; index < current.Length; index++) CallerNative.Require(current[index] == record[index]); }
            finally { Array.Clear(current, 0, current.Length); }
        }
        internal void CheckTuple(EnrollmentInspection.Identity enrollment)
        { CallerNative.Require(enrollment.Root == Root && enrollment.InstallId == InstallId && enrollment.Revision == Revision && enrollment.Epoch == Epoch); }
        public void Dispose()
        {
            if (closed) return; closed = true;
            bool failed = false;
            for (int index = held.Count - 1; index >= 0; index--) try { held[index].Dispose(); } catch { failed = true; }
            if (record != null) Array.Clear(record, 0, record.Length);
            if (failed) throw new InvalidDataException("installed-policy-cleanup-unconfirmed");
        }
    }
}
