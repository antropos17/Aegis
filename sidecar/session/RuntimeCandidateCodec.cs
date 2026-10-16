using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Closed, canonical data grammar. Parsing supplies integrity identifiers only.
    internal sealed class RuntimeCandidateCodec
    {
        internal const int MaximumBytes = 16384;
        internal sealed class Metadata
        {
            internal readonly string InstallId, Epoch, PolicyHash, OperatorSid, SelectionId, SelectionEpoch;
            internal readonly uint Revision;
            internal readonly Guid VmId;
            internal readonly string ConfigurationProfile, ConfigurationHash, OsImageHash, BootstrapHash, PackageHash, EntryPoint;
            internal readonly long OsImageBytes, BootstrapBytes, PackageBytes, JobMemoryBytes, ProcessMemoryBytes;
            internal readonly int MaximumProcesses, DurationMs;
            private readonly string[] arguments;
            internal string[] Arguments { get { return (string[])arguments.Clone(); } }
            internal Metadata(string install, uint revision, string epoch, string policy, string sid, string selection, string selectionEpoch,
                Guid vmId, string profile, string configuration, long osBytes, string osHash, long bootstrapBytes, string bootstrapHash,
                long packageBytes, string packageHash, string entry, string[] args, int processes, long jobBytes, long processBytes, int duration)
            {
                InstallId = install; Revision = revision; Epoch = epoch; PolicyHash = policy; OperatorSid = sid;
                SelectionId = selection; SelectionEpoch = selectionEpoch; VmId = vmId; ConfigurationProfile = profile;
                ConfigurationHash = configuration; OsImageBytes = osBytes; OsImageHash = osHash;
                BootstrapBytes = bootstrapBytes; BootstrapHash = bootstrapHash; PackageBytes = packageBytes; PackageHash = packageHash;
                EntryPoint = entry; arguments = (string[])args.Clone(); MaximumProcesses = processes;
                JobMemoryBytes = jobBytes; ProcessMemoryBytes = processBytes; DurationMs = duration;
            }
        }

        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private readonly string text;
        private int position;
        private RuntimeCandidateCodec(string source) { text = source; }
        private static void Require(bool value) { if (!value) throw new InvalidDataException("runtime-candidate-invalid"); }
        private void Literal(string value)
        {
            Require(position <= text.Length - value.Length && String.CompareOrdinal(text, position, value, 0, value.Length) == 0);
            position += value.Length;
        }
        private string StringValue()
        {
            Literal("\""); var value = new StringBuilder(); bool ended = false;
            while (position < text.Length)
            {
                char item = text[position++];
                if (item == '"') { ended = true; break; }
                Require(!Char.IsControl(item));
                if (item == '\\')
                {
                    Require(position < text.Length); item = text[position++];
                    Require(item == '\\' || item == '"');
                }
                value.Append(item); Require(value.Length <= 2048);
            }
            Require(ended); return value.ToString();
        }
        private string Field(string name) { Literal(",\"" + name + "\":"); return StringValue(); }
        private string Hex(string name, int length)
        {
            string value = Field(name); Require(value.Length == length && Regex.IsMatch(value, "\\A[a-f0-9]+\\z")); return value;
        }
        private long Number(string name, long minimum, long maximum)
        {
            Literal(",\"" + name + "\":"); int start = position;
            while (position < text.Length && text[position] >= '0' && text[position] <= '9') position++;
            string token = text.Substring(start, position - start); long value;
            Require(token.Length > 0 && token.Length <= 20 && (token.Length == 1 || token[0] != '0') &&
                Int64.TryParse(token, NumberStyles.None, CultureInfo.InvariantCulture, out value));
            value = Int64.Parse(token, CultureInfo.InvariantCulture); Require(value >= minimum && value <= maximum); return value;
        }
        private string[] Arguments()
        {
            Literal(",\"arguments\":["); var args = new List<string>(); int bytes = 0;
            if (position < text.Length && text[position] != ']')
                while (true)
                {
                    string value = StringValue(); int size = Utf8.GetByteCount(value);
                    Require(args.Count < 16 && size <= 512 && bytes <= 4096 - size); bytes += size; args.Add(value);
                    if (position >= text.Length || text[position] != ',') break; position++;
                }
            Literal("]"); return args.ToArray();
        }
        private static string Entry(string value)
        {
            Require(value.Length > 0 && value.Length <= 240);
            foreach (string component in value.Split('/'))
            {
                Require(Regex.IsMatch(component, "\\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\z") && !component.EndsWith(".", StringComparison.Ordinal));
                string stem = component.Split('.')[0].ToUpperInvariant();
                Require(stem != "CON" && stem != "PRN" && stem != "AUX" && stem != "NUL" &&
                    !Regex.IsMatch(stem, "\\A(?:COM|LPT)[1-9]\\z"));
            }
            return value;
        }
        internal static Metadata Parse(byte[] bytes)
        {
            try { return ParseCore(bytes); }
            catch (ArgumentException) { throw new InvalidDataException("runtime-candidate-invalid"); }
        }
        private static Metadata ParseCore(byte[] bytes)
        {
            Require(bytes != null && bytes.Length > 0 && bytes.Length <= MaximumBytes);
            var reader = new RuntimeCandidateCodec(Utf8.GetString(bytes));
            reader.Literal("{\"schemaVersion\":1");
            string install = reader.Hex("installId", 32);
            uint revision = (uint)reader.Number("revision", 1, UInt32.MaxValue);
            string epoch = reader.Hex("epoch", 32), policy = reader.Hex("policySha256", 64);
            string sid = reader.Field("operatorSid");
            Require(Regex.IsMatch(sid, "\\AS-1-(?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){1,15}\\z") && new SecurityIdentifier(sid).Value == sid);
            string selection = reader.Hex("selectionId", 32), selectionEpoch = reader.Hex("selectionEpoch", 32);
            string vmText = reader.Field("vmId"); Guid vm;
            Require(Guid.TryParseExact(vmText, "D", out vm) && vm != Guid.Empty && vm.ToString("D") == vmText);
            string profile = reader.Field("configurationProfile"); Require(profile == VmConfigurationProfile.Name);
            string configuration = reader.Hex("configurationSha256", 64);
            long osBytes = reader.Number("osImageBytes", 1024 * 1024, 64L * 1024 * 1024 * 1024); string osHash = reader.Hex("osImageSha256", 64);
            long bootstrapBytes = reader.Number("bootstrapBytes", 1, 4 * 1024 * 1024); string bootstrapHash = reader.Hex("bootstrapSha256", 64);
            long packageBytes = reader.Number("packageBytes", 1, 4 * 1024 * 1024); string packageHash = reader.Hex("packageSha256", 64);
            string entry = Entry(reader.Field("entryPoint")); string[] args = reader.Arguments();
            int processes = (int)reader.Number("maximumProcesses", 1, 32);
            long jobBytes = reader.Number("jobMemoryBytes", 1, 512 * 1024 * 1024);
            long processBytes = reader.Number("processMemoryBytes", 1, 512 * 1024 * 1024); Require(processBytes <= jobBytes);
            int duration = (int)reader.Number("durationMs", 100, 120000);
            reader.Literal(",\"status\":\"candidate\"}"); Require(reader.position == reader.text.Length);
            return new Metadata(install, revision, epoch, policy, sid, selection, selectionEpoch, vm, profile, configuration,
                osBytes, osHash, bootstrapBytes, bootstrapHash, packageBytes, packageHash, entry, args, processes, jobBytes, processBytes, duration);
        }
    }
}
