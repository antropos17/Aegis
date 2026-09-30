using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

// Qualification transport state only. No VM/caller authority or closure oracle.
internal sealed class GuestChannelWire : IDisposable
{
    private readonly byte[] key;
    private readonly Dictionary<string, object> context;
    private readonly bool host;
    private int sent, received;
    private string state = "ready";
    private static readonly string[] Fields = { "protocol", "version", "sessionId", "vmId", "epoch", "challenge", "direction", "sequence", "operation", "dataBase64", "mac" };
    internal GuestChannelWire(byte[] secret, Dictionary<string, object> binding, bool hostRole)
    {
        BootstrapWire.Require(secret.Length == 32);
        key = (byte[])secret.Clone(); context = new Dictionary<string, object>(binding); host = hostRole;
    }
    private static void Require(bool value, string code) { BootstrapWire.Require(value, code); }
    private string Canonical(Dictionary<string, object> value)
    {
        return "{\"protocol\":\"aegis-guest-channel\",\"version\":1,\"sessionId\":\"" + BootstrapWire.Text(value, "sessionId") +
            "\",\"vmId\":\"" + BootstrapWire.Text(value, "vmId") + "\",\"epoch\":\"" + BootstrapWire.Text(value, "epoch") +
            "\",\"challenge\":\"" + BootstrapWire.Text(value, "challenge") + "\",\"direction\":\"" + BootstrapWire.Text(value, "direction") +
            "\",\"sequence\":" + Convert.ToInt32(value["sequence"]).ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"operation\":\"" + BootstrapWire.Text(value, "operation") + "\",\"dataBase64\":\"" + BootstrapWire.Text(value, "dataBase64") + "\"}";
    }
    private byte[] Payload(Dictionary<string, object> value)
    {
        string canonical = Canonical(value);
        using (var hmac = new HMACSHA256(key))
        {
            string mac = BootstrapWire.Hex(hmac.ComputeHash(BootstrapWire.Utf8.GetBytes(canonical)));
            return BootstrapWire.Utf8.GetBytes(canonical.Substring(0, canonical.Length - 1) + ",\"mac\":\"" + mac + "\"}");
        }
    }
    private static byte[] Data(string operation, string encoded)
    {
        Require(encoded.Length <= 2732, "channel-schema");
        byte[] data = Convert.FromBase64String(encoded);
        Require(data.Length > 0 && data.Length <= 2048 && Convert.ToBase64String(data) == encoded, "channel-schema");
        if (operation != "result")
        {
            string control = operation == "release" ? "R" : operation == "cancel" ? "C" : operation == "stopped" ? "S" : "";
            Require(control.Length == 1 && data.Length == 1 && data[0] == (byte)control[0], "channel-schema");
        }
        return data;
    }
    private string Next(string operation, bool sending)
    {
        Require(state != "closed" && state != "unavailable", "channel-state");
        if (host == sending)
        {
            if (operation == "release") { Require(state == "ready", "channel-state"); return "running"; }
            Require(operation == "cancel" && (state == "ready" || state == "running" || state == "result-received" || state == "result-sent"), "channel-state");
            return "cancelling";
        }
        if (operation == "result") { Require(state == "running", "channel-state"); return host ? "result-received" : "result-sent"; }
        Require(operation == "stopped" && (state == "cancelling" || state == "result-received" || state == "result-sent"), "channel-state");
        return "closed";
    }
    private void Finish(string next) { state = next; Array.Clear(key, 0, key.Length); }
    internal byte[] Send(string operation, byte[] data)
    {
        try
        {
            Require(sent < 4, "channel-sequence");
            string encoded = Convert.ToBase64String(data); Data(operation, encoded);
            var value = new Dictionary<string, object>(context);
            value["direction"] = host ? "host-to-guest" : "guest-to-host";
            value["sequence"] = sent + 1; value["operation"] = operation; value["dataBase64"] = encoded;
            string next = Next(operation, true);
            byte[] payload = Payload(value); Require(payload.Length <= 4096, "channel-schema"); sent++;
            if (next == "closed") Finish(next); else state = next;
            return payload;
        }
        catch { Finish("unavailable"); throw; }
    }
    internal byte[] Accept(byte[] payload, out string operation)
    {
        try
        {
            Require(payload.Length > 0 && payload.Length <= 4096, "channel-schema");
            string text = BootstrapWire.Utf8.GetString(payload);
            var value = BootstrapWire.Json().Deserialize<Dictionary<string, object>>(text);
            Require(value != null && value.Count == Fields.Length, "channel-schema");
            foreach (string field in Fields) Require(value.ContainsKey(field), "channel-schema");
            Require(BootstrapWire.Text(value, "protocol") == "aegis-guest-channel" && value["version"] is int && (int)value["version"] == 1, "channel-schema");
            Require(value["sequence"] is int && (int)value["sequence"] >= 1 && (int)value["sequence"] <= 4, "channel-schema");
            operation = BootstrapWire.Text(value, "operation");
            Require(operation == "release" || operation == "cancel" || operation == "result" || operation == "stopped", "channel-schema");
            byte[] data = Data(operation, BootstrapWire.Text(value, "dataBase64"));
            Require(Regex.IsMatch(BootstrapWire.Text(value, "mac"), "\\A[a-f0-9]{64}\\z"), "channel-schema");
            byte[] wanted = Payload(value);
            int difference = wanted.Length ^ payload.Length;
            for (int i = 0; i < wanted.Length; i++) difference |= wanted[i] ^ (i < payload.Length ? payload[i] : 0);
            Array.Clear(wanted, 0, wanted.Length);
            Require(difference == 0, "channel-authentication");
            foreach (string field in new string[] { "sessionId", "vmId", "epoch", "challenge" })
                Require(BootstrapWire.Text(value, field) == BootstrapWire.Text(context, field), "channel-context");
            Require(BootstrapWire.Text(value, "direction") == (host ? "guest-to-host" : "host-to-guest"), "channel-context");
            Require((int)value["sequence"] == received + 1, "channel-sequence");
            string next = Next(operation, false); received++;
            if (next == "closed") Finish(next); else state = next;
            return data;
        }
        catch { Finish("unavailable"); throw; }
    }
    public void Dispose() { Finish("closed"); }
}
