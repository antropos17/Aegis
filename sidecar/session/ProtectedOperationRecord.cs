using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Integrity metadata only. Matching scalar values do not establish a retained owner.
    internal sealed class ProtectedOperationBinding
    {
        internal readonly string InstallId, Epoch, PolicySha256, SelectionId, SelectionEpoch;
        internal readonly string VmIdentitySha256, ConfigurationProfile, ConfigurationSha256, SessionId, SessionEpoch;
        internal readonly uint Revision;
        internal readonly Guid VmId;
        internal readonly string Canonical;
        internal ProtectedOperationBinding(string install, uint revision, string epoch, string policy,
            string selection, string selectionEpoch, Guid vm, string identity, string profile,
            string configuration, string session, string sessionEpoch)
        {
            InstallId = install; Revision = revision; Epoch = epoch; PolicySha256 = policy;
            SelectionId = selection; SelectionEpoch = selectionEpoch; VmId = vm; VmIdentitySha256 = identity;
            ConfigurationProfile = profile; ConfigurationSha256 = configuration; SessionId = session; SessionEpoch = sessionEpoch;
            Canonical = "{\"schemaVersion\":1,\"installId\":\"" + install + "\",\"revision\":" + revision.ToString(CultureInfo.InvariantCulture) +
                ",\"epoch\":\"" + epoch + "\",\"policySha256\":\"" + policy + "\",\"selectionId\":\"" + selection +
                "\",\"selectionEpoch\":\"" + selectionEpoch + "\",\"vmId\":\"" + vm.ToString("D") +
                "\",\"vmIdentitySha256\":\"" + identity + "\",\"configurationProfile\":\"" + profile +
                "\",\"configurationSha256\":\"" + configuration + "\",\"sessionId\":\"" + session + "\",\"sessionEpoch\":\"" + sessionEpoch + "\"";
            ProtectedOperationRecord.Require(vm != Guid.Empty && ProtectedOperationRecord.BindingSchema.IsMatch(Canonical + "}"));
        }
    }

    internal enum ProtectedOperationPhase
    { RecordedIntent, DurablyConsumed, DispatchedUnknown, SettledSuccess, SettledFailure, RevokedAdmission }

    // Closed canonical data codec. No writer, callback, admission or dispatch authority.
    internal sealed class ProtectedOperationRecord
    {
        internal const int MaximumBytes = 2048;
        internal const string ZeroHash = "0000000000000000000000000000000000000000000000000000000000000000";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private const string H32 = "[a-f0-9]{32}", H64 = "[a-f0-9]{64}";
        private const string GuidD = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
        private const string Prefix = "\\A\\{\"schemaVersion\":1,\"installId\":\"(?<install>" + H32 + ")\",\"revision\":(?<revision>[1-9][0-9]{0,9})," +
            "\"epoch\":\"(?<epoch>" + H32 + ")\",\"policySha256\":\"(?<policy>" + H64 + ")\"," +
            "\"selectionId\":\"(?<selection>" + H32 + ")\",\"selectionEpoch\":\"(?<selectionEpoch>" + H32 + ")\"," +
            "\"vmId\":\"(?<vm>" + GuidD + ")\",\"vmIdentitySha256\":\"(?<identity>" + H64 + ")\"," +
            "\"configurationProfile\":\"(?<profile>" + VmConfigurationProfile.Name + ")\",\"configurationSha256\":\"(?<configuration>" + H64 + ")\"," +
            "\"sessionId\":\"(?<session>" + H32 + ")\",\"sessionEpoch\":\"(?<sessionEpoch>" + H32 + ")\"";
        internal static readonly Regex BindingSchema = new Regex(Prefix + "\\}\\z", RegexOptions.CultureInvariant);
        private const string Tail = ",\"sequence\":(?<sequence>[1-9][0-9]{0,9}),\"previousSha256\":\"(?<previous>" + H64 + ")\",\"phase\":\"";
        private static readonly Regex Operation = new Regex(Prefix + ",\"operationId\":\"(?<operation>" + H32 +
            ")\",\"requestedState\":(?<state>[23]),\"operationSha256\":\"(?<digest>" + H64 + ")\"" + Tail +
            "(?<phase>recorded-intent|durably-consumed|dispatched-unknown|settled-success|settled-failure)\"\\}\n\\z", RegexOptions.CultureInvariant);
        private static readonly Regex Revoke = new Regex(Prefix + Tail + "(?<phase>revoked-admission)\"\\}\n\\z", RegexOptions.CultureInvariant);
        private static readonly string[] Names = { "recorded-intent", "durably-consumed", "dispatched-unknown", "settled-success", "settled-failure", "revoked-admission" };
        internal readonly ProtectedOperationBinding Binding;
        internal readonly VmOperationRecord Intent;
        internal readonly ProtectedOperationPhase Phase;
        internal readonly uint Sequence;
        internal readonly string PreviousSha256, OperationSha256, RecordSha256;
        private readonly byte[] bytes;

        private ProtectedOperationRecord(ProtectedOperationBinding binding, VmOperationRecord intent,
            ProtectedOperationPhase phase, uint sequence, string previous)
        {
            Require(binding != null && sequence > 0 && sequence <= ProtectedOperationState.MaximumRecords &&
                Regex.IsMatch(previous ?? "", "\\A" + H64 + "\\z") && (int)phase >= 0 && (int)phase < Names.Length);
            Binding = binding; Intent = intent; Phase = phase; Sequence = sequence; PreviousSha256 = previous;
            string text = binding.Canonical;
            if (phase == ProtectedOperationPhase.RevokedAdmission) Require(intent == null);
            else
            {
                Require(intent != null && intent.OperationId != Guid.Empty && intent.VmId == binding.VmId &&
                    (intent.RequestedState == 2 || intent.RequestedState == 3) && intent.Unresolved && intent.JobPath == null && !intent.ReturnCode.HasValue);
                text += ",\"operationId\":\"" + intent.OperationId.ToString("N") + "\",\"requestedState\":" + intent.RequestedState.ToString(CultureInfo.InvariantCulture);
                OperationSha256 = EnrollmentInspection.ImageHash(Utf8.GetBytes("aegis-protected-operation-intent-v1\n" + text + "}"));
                text += ",\"operationSha256\":\"" + OperationSha256 + "\"";
            }
            bytes = Utf8.GetBytes(text + ",\"sequence\":" + sequence.ToString(CultureInfo.InvariantCulture) +
                ",\"previousSha256\":\"" + previous + "\",\"phase\":\"" + Names[(int)phase] + "\"}\n");
            Require(bytes.Length <= MaximumBytes); RecordSha256 = EnrollmentInspection.ImageHash(bytes);
        }
        internal byte[] Encode() { return (byte[])bytes.Clone(); }
        internal static ProtectedOperationRecord Parse(byte[] exactFrame)
        {
            Require(exactFrame != null && exactFrame.Length > 0 && exactFrame.Length <= MaximumBytes);
            byte[] owned = (byte[])exactFrame.Clone(); Match match = Operation.Match(Utf8.GetString(owned));
            if (!match.Success) match = Revoke.Match(Utf8.GetString(owned));
            Require(match.Success); uint revision = 0, sequence = 0;
            Require(UInt32.TryParse(match.Groups["revision"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out revision) &&
                UInt32.TryParse(match.Groups["sequence"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out sequence));
            var binding = new ProtectedOperationBinding(match.Groups["install"].Value, revision, match.Groups["epoch"].Value,
                match.Groups["policy"].Value, match.Groups["selection"].Value, match.Groups["selectionEpoch"].Value,
                Guid.ParseExact(match.Groups["vm"].Value, "D"), match.Groups["identity"].Value, match.Groups["profile"].Value,
                match.Groups["configuration"].Value, match.Groups["session"].Value, match.Groups["sessionEpoch"].Value);
            int phase = Array.IndexOf(Names, match.Groups["phase"].Value); VmOperationRecord intent = null;
            if (phase != (int)ProtectedOperationPhase.RevokedAdmission)
                intent = new VmOperationRecord(Guid.ParseExact(match.Groups["operation"].Value, "N"), binding.VmId,
                    UInt16.Parse(match.Groups["state"].Value, CultureInfo.InvariantCulture), null, null, true);
            var record = new ProtectedOperationRecord(binding, intent, (ProtectedOperationPhase)phase, sequence, match.Groups["previous"].Value);
            Require(Equal(owned, record.bytes)); return record;
        }
        internal static bool Equal(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            for (int index = 0; index < left.Length; index++) if (left[index] != right[index]) return false;
            return true;
        }
        internal static void Require(bool condition) { if (!condition) throw new InvalidDataException("protected-operation-unavailable"); }
#if PROTECTED_OPERATION_TEST
        internal static ProtectedOperationRecord CreateForTest(ProtectedOperationBinding binding, VmOperationRecord intent,
            ProtectedOperationPhase phase, uint sequence, string previous)
        { return new ProtectedOperationRecord(binding, intent, phase, sequence, previous); }
#endif
    }
}
