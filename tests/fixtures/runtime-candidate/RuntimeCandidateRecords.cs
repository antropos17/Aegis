using System;
using System.Text;
using Aegis.ProtectedSession;

// Deliberately dummy candidate identifiers. None identifies approved executable bytes.
internal static class RuntimeCandidateRecords
{
    internal const string Install = "11111111111111111111111111111111", Epoch = "22222222222222222222222222222222";
    internal const string Selection = "44444444444444444444444444444444", SelectionEpoch = "55555555555555555555555555555555";
    internal static readonly string PolicyHash = new string('3', 64), ConfigurationHash = new string('8', 64);
    internal static readonly Guid VmId = new Guid("11111111-2222-3333-4444-555555555555");
    internal const string Identity = "modeled-original-vm-settings";
    internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    internal static string Candidate(string sid)
    {
        return "{\"schemaVersion\":1,\"installId\":\"" + Install + "\",\"revision\":1,\"epoch\":\"" + Epoch +
            "\",\"policySha256\":\"" + PolicyHash + "\",\"operatorSid\":\"" + sid + "\",\"selectionId\":\"" + Selection +
            "\",\"selectionEpoch\":\"" + SelectionEpoch + "\",\"vmId\":\"" + VmId.ToString("D") +
            "\",\"configurationProfile\":\"" + VmConfigurationProfile.Name + "\",\"configurationSha256\":\"" + ConfigurationHash +
            "\",\"osImageBytes\":1048576,\"osImageSha256\":\"" + new string('a', 64) +
            "\",\"bootstrapBytes\":1,\"bootstrapSha256\":\"" + new string('b', 64) +
            "\",\"packageBytes\":1,\"packageSha256\":\"" + new string('c', 64) +
            "\",\"entryPoint\":\"fixture/data.bin\",\"arguments\":[\"fixture-only\",\"marker=one\"]," +
            "\"maximumProcesses\":1,\"jobMemoryBytes\":536870912,\"processMemoryBytes\":536870912,\"durationMs\":100,\"status\":\"candidate\"}";
    }
    internal static string Vm(string storage)
    {
        return "{\"schemaVersion\":4,\"installId\":\"" + Install + "\",\"revision\":1,\"epoch\":\"" + Epoch +
            "\",\"policySha256\":\"" + PolicyHash + "\",\"selectionId\":\"" + Selection + "\",\"selectionEpoch\":\"" + SelectionEpoch +
            "\",\"vmId\":\"" + VmId.ToString("D") + "\",\"identitySha256\":\"" + EnrollmentInspection.ImageHash(Utf8.GetBytes(Identity)) +
            "\",\"storageSha256\":\"" + storage + "\",\"storageProtection\":\"private-vm\",\"configurationProfile\":\"" +
            VmConfigurationProfile.Name + "\",\"configurationSha256\":\"" + ConfigurationHash + "\",\"status\":\"active\"}";
    }
    internal static byte[] Bytes(string text, string mode)
    {
        if (mode == "unknown") text = text.Replace("\"status\"", "\"unknown\":true,\"status\"");
        if (mode == "approved") text = text.Replace("\"status\"", "\"approved\":true,\"status\"");
        if (mode == "host-command") text = text.Replace("\"status\"", "\"hostCommand\":\"cmd.exe\",\"status\"");
        if (mode == "provider-url") text = text.Replace("\"status\"", "\"providerUrl\":\"https://invalid.example\",\"status\"");
        if (mode == "credential") text = text.Replace("\"status\"", "\"credential\":\"fixture\",\"status\"");
        if (mode == "approver") text = text.Replace("\"status\"", "\"approverSid\":\"S-1-5-18\",\"status\"");
        if (mode == "duplicate") text = text.Replace("\"revision\":1", "\"revision\":1,\"revision\":1");
        if (mode == "whitespace") text = " " + text;
        if (mode == "bom") text = "\ufeff" + text;
        if (mode == "trailing") text += "\n";
        if (mode == "truncated") text = text.Substring(0, text.Length - 1);
        if (mode == "reordered") text = text.Replace("\"schemaVersion\":1,\"installId\":", "\"installId\":");
        if (mode == "leading-zero") text = text.Replace("\"revision\":1", "\"revision\":01");
        if (mode == "number-type") text = text.Replace("\"revision\":1", "\"revision\":\"1\"");
        if (mode == "number-overflow") text = text.Replace("\"revision\":1", "\"revision\":18446744073709551616");
        if (mode == "revision-zero") text = text.Replace("\"revision\":1", "\"revision\":0");
        if (mode == "hash-upper") text = text.Replace(new string('a', 64), new string('A', 64));
        if (mode == "hash-short") text = text.Replace(new string('a', 64), "a");
        if (mode == "sid-overflow") text = text.Replace("\"operatorSid\":\"S-1-5-21-1\"", "\"operatorSid\":\"S-1-5-9999999999\"");
        if (mode == "vm-empty") text = text.Replace(VmId.ToString("D"), Guid.Empty.ToString("D"));
        if (mode == "vm-upper") text = text.Replace(VmId.ToString("D"), "AAAAAAAA-2222-3333-4444-555555555555");
        if (mode == "profile") text = text.Replace(VmConfigurationProfile.Name, "unsupported");
        if (mode == "os-small") text = text.Replace("\"osImageBytes\":1048576", "\"osImageBytes\":1");
        if (mode == "os-large") text = text.Replace("\"osImageBytes\":1048576", "\"osImageBytes\":68719476737");
        if (mode == "bootstrap-large") text = text.Replace("\"bootstrapBytes\":1", "\"bootstrapBytes\":4194305");
        if (mode == "package-large") text = text.Replace("\"packageBytes\":1", "\"packageBytes\":4194305");
        if (mode == "package-zero") text = text.Replace("\"packageBytes\":1", "\"packageBytes\":0");
        if (mode.StartsWith("entry-", StringComparison.Ordinal))
        {
            string entry = mode.Substring(6);
            if (entry == "absolute") entry = "/data.bin";
            if (entry == "drive") entry = "C:/data.bin";
            if (entry == "device") entry = "//?/C:/data.bin";
            if (entry == "traversal") entry = "fixture/../data.bin";
            if (entry == "ads") entry = "fixture/data.bin:stream";
            if (entry == "reserved") entry = "fixture/CON.bin";
            if (entry == "empty") entry = "fixture//data.bin";
            if (entry == "dot") entry = "fixture./data.bin";
            if (entry == "long") entry = new string('a', 241);
            text = text.Replace("fixture/data.bin", entry);
        }
        if (mode == "args-count")
        { var args = new string[17]; for (int i = 0; i < args.Length; i++) args[i] = "\"fixture\""; text = text.Replace("\"fixture-only\",\"marker=one\"", String.Join(",", args)); }
        if (mode == "args-size") text = text.Replace("fixture-only", new string('x', 513));
        if (mode == "args-total")
        { var args = new string[9]; for (int i = 0; i < args.Length; i++) args[i] = "\"" + new string('x', 512) + "\""; text = text.Replace("\"fixture-only\",\"marker=one\"", String.Join(",", args)); }
        if (mode == "args-nul") text = text.Replace("fixture-only", "fixture\0only");
        if (mode == "args-escape") text = text.Replace("fixture-only", "\\u0066ixture-only");
        if (mode == "args-type") text = text.Replace("[\"fixture-only\",\"marker=one\"]", "null");
        if (mode == "args-unicode") text = text.Replace("fixture-only", "fixture-данные");
        if (mode == "args-quoted") text = text.Replace("fixture-only", "fixture-\\\\quoted\\\"");
        if (mode == "args-empty") text = text.Replace("[\"fixture-only\",\"marker=one\"]", "[]");
        if (mode == "maxima")
            text = text.Replace("\"osImageBytes\":1048576", "\"osImageBytes\":68719476736")
                .Replace("\"bootstrapBytes\":1", "\"bootstrapBytes\":4194304")
                .Replace("\"packageBytes\":1", "\"packageBytes\":4194304")
                .Replace("\"maximumProcesses\":1", "\"maximumProcesses\":32")
                .Replace("\"durationMs\":100", "\"durationMs\":120000");
        if (mode == "processes") text = text.Replace("\"maximumProcesses\":1", "\"maximumProcesses\":33");
        if (mode == "job-memory") text = text.Replace("\"jobMemoryBytes\":536870912", "\"jobMemoryBytes\":536870913");
        if (mode == "process-memory") text = text.Replace("\"processMemoryBytes\":536870912", "\"processMemoryBytes\":536870913");
        if (mode == "process-over-job") text = text.Replace("\"jobMemoryBytes\":536870912", "\"jobMemoryBytes\":1");
        if (mode == "duration-small") text = text.Replace("\"durationMs\":100", "\"durationMs\":99");
        if (mode == "duration-large") text = text.Replace("\"durationMs\":100", "\"durationMs\":120001");
        if (mode == "status") text = text.Replace("\"candidate\"}", "\"active\"}");
        if (mode == "record-large") text = new string('x', 16385);
        if (mode == "invalid-utf8") return new byte[] { 0xff, 0xfe, 0x80 };
        return Utf8.GetBytes(text);
    }
}
