using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Aegis.ProtectedSession;

// Synthetic protected-policy authority; records, file identities, pinned image
// bytes and the production fixed-operation reader are real.
internal static class FixedOperationRecords
{
    internal const string FixtureId = "installed-inventory-inspection-v1";
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    internal static string Text(string path) { return Utf8.GetString(File.ReadAllBytes(path)); }
    internal static void Save(string path, string value) { File.WriteAllText(path, value, Utf8); }
    internal static string S(string json, string name)
    {
        Match match = Regex.Match(json, "\"" + name + "\":\"([^\"]+)\"");
        CallerNative.Require(match.Success); return match.Groups[1].Value;
    }
    internal static uint N(string json, string name)
    {
        Match match = Regex.Match(json, "\"" + name + "\":([0-9]+)");
        uint value; CallerNative.Require(match.Success && UInt32.TryParse(match.Groups[1].Value, out value));
        return UInt32.Parse(match.Groups[1].Value);
    }
    internal static InstalledOwnerPolicy Policy(string root)
    {
        string json = Text(Path.Combine(root, "owner-policy.json"));
        return InstalledOwnerPolicy.CreateForTest(root, S(json, "installId"), N(json, "revision"), S(json, "epoch"),
            S(json, "operatorSid"), S(json, "selectionId"), S(json, "selectionEpoch"), CompositionFiles.Hash(Path.Combine(root, "owner-policy.json")),
            (int)N(json, "mainImageSize"), S(json, "mainImageSha256"), (int)N(json, "supervisorImageSize"), S(json, "supervisorImageSha256"));
    }
    internal static void Write(string root, string mode)
    {
        string install = new string('a', 32), epoch = new string('b', 32), selection = new string('c', 32), selectionEpoch = new string('d', 32);
        uint revision = 1;
        if (mode == "policy-selection") { selection = new string('f', 32); selectionEpoch = new string('a', 32); }
        if (mode == "policy-epoch") selectionEpoch = new string('f', 32);
        if (mode == "policy-revision") revision = 2;
        string main = Path.Combine(root, "aegis-main.exe"), supervisor = Path.Combine(root, "aegis-session.exe"), inventory = Path.Combine(root, "inventory.json");
        string sid;
        using (var current = Process.GetCurrentProcess())
        using (var held = CallerNative.Duplicate(current.Handle))
        using (var token = CallerNative.ProcessToken(held)) sid = CallerIdentity.Observe(token).OperatorSid;
        string policy = "{\"schemaVersion\":1,\"installId\":\"" + install + "\",\"revision\":" + revision + ",\"epoch\":\"" + epoch +
            "\",\"operatorSid\":\"" + sid + "\",\"selectionId\":\"" + selection + "\",\"selectionEpoch\":\"" + selectionEpoch +
            "\",\"mainImageSize\":" + new FileInfo(main).Length + ",\"mainImageSha256\":\"" + CompositionFiles.Hash(main) +
            "\",\"supervisorImageSize\":" + new FileInfo(supervisor).Length + ",\"supervisorImageSha256\":\"" + CompositionFiles.Hash(supervisor) + "\"}";
        // These two controls keep policy and manifest independently consistent;
        // the original actual image/proof must reject their declared metadata.
        if (mode == "fixed-main-mismatch") policy = ReplaceValue(policy, "mainImageSha256", new string('f', 64));
        if (mode == "fixed-supervisor-mismatch") policy = ReplaceValue(policy, "supervisorImageSha256", new string('f', 64));
        Save(Path.Combine(root, "owner-policy.json"), policy);
        string fixture = "{\"schemaVersion\":1,\"fixtureId\":\"" + FixtureId + "\",\"scope\":\"retained-inventory-inspection\",\"selectionId\":\"" + selection +
            "\",\"selectionEpoch\":\"" + selectionEpoch + "\",\"inventoryBytes\":" + new FileInfo(inventory).Length +
            ",\"inventorySha256\":\"" + CompositionFiles.Hash(inventory) + "\",\"mainImageBytes\":" + new FileInfo(main).Length +
            ",\"mainImageSha256\":\"" + CompositionFiles.Hash(main) + "\",\"supervisorImageBytes\":" + new FileInfo(supervisor).Length +
            ",\"supervisorImageSha256\":\"" + CompositionFiles.Hash(supervisor) + "\"}";
        if (mode == "fixed-inventory-mismatch") fixture = fixture.Replace(CompositionFiles.Hash(inventory), new string('f', 64));
        if (mode == "fixed-main-mismatch") fixture = ReplaceValue(fixture, "mainImageSha256", new string('f', 64));
        if (mode == "fixed-supervisor-mismatch") fixture = ReplaceValue(fixture, "supervisorImageSha256", new string('f', 64));
        Save(Path.Combine(root, "fixed-fixture.json"), fixture);
        string operation = "{\"schemaVersion\":1,\"installId\":\"" + install + "\",\"revision\":" + revision + ",\"epoch\":\"" + epoch +
            "\",\"policySha256\":\"" + CompositionFiles.Hash(Path.Combine(root, "owner-policy.json")) + "\",\"operatorSid\":\"" + sid +
            "\",\"selectionId\":\"" + selection + "\",\"selectionEpoch\":\"" + selectionEpoch + "\",\"fixtureId\":\"" + FixtureId +
            "\",\"fixtureManifestBytes\":" + new FileInfo(Path.Combine(root, "fixed-fixture.json")).Length +
            ",\"fixtureManifestSha256\":\"" + CompositionFiles.Hash(Path.Combine(root, "fixed-fixture.json")) + "\",\"operations\":[\"inspect-owned\"],\"status\":\"active\"}";
        Save(Path.Combine(root, "registered-operation.json"), operation);
        if (mode == "fixed-missing-operation") File.Delete(Path.Combine(root, "registered-operation.json"));
        if (mode == "fixed-missing-fixture") File.Delete(Path.Combine(root, "fixed-fixture.json"));
    }
    private static string ReplaceValue(string json, string key, string value)
    { return Regex.Replace(json, "(\"" + key + "\":\")[^\"]+(\")", "${1}" + value + "${2}"); }
}
