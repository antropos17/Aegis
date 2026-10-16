using System;
using System.Globalization;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Closed installer metadata. A parsed value alone is never live write authority.
    internal sealed class ProtectedJournalRegistration
    {
        internal const int MaximumBytes = 2048;
        internal readonly string InstallId, Epoch, PolicyHash, SelectionId, SelectionEpoch, Generation;
        internal readonly string DirectoryVolume, DirectoryId, DirectorySecurity, Leaf, FileVolume, FileId, FileSecurity;
        internal readonly uint Revision;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private const string H32 = "[a-f0-9]{32}", H64 = "[a-f0-9]{64}", H16 = "[a-f0-9]{16}";
        private static readonly Regex Schema = new Regex("\\A\\{\"schemaVersion\":1,\"scope\":\"protected-operation-journal\"," +
            "\"installId\":\"(" + H32 + ")\",\"revision\":([1-9][0-9]{0,9}),\"epoch\":\"(" + H32 + ")\",\"policySha256\":\"(" + H64 + ")\"," +
            "\"selectionId\":\"(" + H32 + ")\",\"selectionEpoch\":\"(" + H32 + ")\",\"journalGeneration\":\"(" + H32 + ")\"," +
            "\"directoryVolumeSerial\":\"(" + H16 + ")\",\"directoryFileId\":\"(" + H32 + ")\",\"directorySecuritySha256\":\"(" + H64 + ")\"," +
            "\"journalLeaf\":\"(operations-" + H32 + "-" + H32 + "-[1-9][0-9]{0,9}\\.jsonl)\",\"fileVolumeSerial\":\"(" + H16 + ")\"," +
            "\"fileId\":\"(" + H32 + ")\",\"fileSecuritySha256\":\"(" + H64 + ")\",\"status\":\"active\"\\}\\z", RegexOptions.CultureInvariant);
        private ProtectedJournalRegistration(Match match)
        {
            InstallId = match.Groups[1].Value; Require(UInt32.TryParse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out Revision));
            Epoch = match.Groups[3].Value; PolicyHash = match.Groups[4].Value; SelectionId = match.Groups[5].Value; SelectionEpoch = match.Groups[6].Value;
            Generation = match.Groups[7].Value; DirectoryVolume = match.Groups[8].Value; DirectoryId = match.Groups[9].Value;
            DirectorySecurity = match.Groups[10].Value; Leaf = match.Groups[11].Value; FileVolume = match.Groups[12].Value;
            FileId = match.Groups[13].Value; FileSecurity = match.Groups[14].Value;
            Require(DirectoryVolume != new string('0', 16) && DirectoryId != new string('0', 32) && FileId != new string('0', 32) &&
                FileVolume == DirectoryVolume && Leaf == "operations-" + InstallId + "-" + Epoch + "-" + Revision.ToString(CultureInfo.InvariantCulture) + ".jsonl");
        }
        internal static ProtectedJournalRegistration Parse(byte[] bytes)
        {
            Require(bytes != null && bytes.Length > 0 && bytes.Length <= MaximumBytes);
            Match match = Schema.Match(Utf8.GetString(bytes)); Require(match.Success); return new ProtectedJournalRegistration(match);
        }
        internal void CheckPolicy(InstalledOwnerPolicy policy)
        {
            Require(policy != null && InstallId == policy.InstallId && Revision == policy.Revision && Epoch == policy.Epoch &&
                PolicyHash == policy.Digest && SelectionId == policy.SelectionId && SelectionEpoch == policy.SelectionEpoch);
        }
        internal void CheckBinding(ProtectedOperationBinding binding)
        {
            Require(binding != null && InstallId == binding.InstallId && Revision == binding.Revision && Epoch == binding.Epoch &&
                PolicyHash == binding.PolicySha256 && SelectionId == binding.SelectionId && SelectionEpoch == binding.SelectionEpoch);
        }
        internal byte[] Header(ProtectedOperationBinding binding)
        {
            CheckBinding(binding);
            byte[] bytes = Utf8.GetBytes("{\"schemaVersion\":1,\"scope\":\"live-protected-journal\",\"journalGeneration\":\"" + Generation +
                "\",\"nonce\":\"" + Nonce() + "\",\"fileVolumeSerial\":\"" + FileVolume + "\",\"fileId\":\"" + FileId +
                "\",\"binding\":" + binding.Canonical + "}}\n");
            Require(bytes.Length <= MaximumBytes); return bytes;
        }
        internal static string Nonce()
        {
            byte[] bytes = new byte[16]; using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
        internal static string SecurityHash(byte[] bytes)
        {
            string sddl = new RawSecurityDescriptor(bytes, 0).GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
            return EnrollmentInspection.ImageHash(Utf8.GetBytes(sddl));
        }
        internal static void Require(bool value) { if (!value) throw new InvalidDataException("protected-journal-unavailable"); }
    }
}
