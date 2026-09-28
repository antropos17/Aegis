using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class BootstrapWire
{
    internal static string Phase = "initial-input";
    internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    internal static readonly string[] BindingKeys = { "key", "sessionId", "vmId", "epoch", "challenge" };
    internal static readonly string[] Pins = { "imageSha256", "runtimeSha256", "principalSha256", "jobSha256" };
    internal static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 8 }; }
    internal static void Require(bool value, string code = "bootstrap-invalid") { if (!value) throw new InvalidDataException(code); }
    internal static string Hash(byte[] value)
    {
        using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(value));
    }
    internal static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
    internal static string HashFile(string filename)
    {
        using (var file = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(file));
    }
    internal static string Text(Dictionary<string, object> value, string key)
    {
        object item;
        Require(value.TryGetValue(key, out item) && item is string);
        return (string)item;
    }
    internal static string BindingJson(Dictionary<string, object> value)
    {
        return "{\"key\":\"" + Text(value, "key") + "\",\"sessionId\":\"" + Text(value, "sessionId") +
            "\",\"vmId\":\"" + Text(value, "vmId") + "\",\"epoch\":\"" + Text(value, "epoch") +
            "\",\"challenge\":\"" + Text(value, "challenge") + "\"}";
    }
    internal static Dictionary<string, object> ReadBinding(Stream stream, IntPtr pipe)
    {
        string text = Utf8.GetString(ReadFrame(stream, pipe, 1000));
        var value = Json().Deserialize<Dictionary<string, object>>(text);
        Require(value != null && value.Count == 5);
        foreach (string name in BindingKeys) Text(value, name);
        Require(Regex.IsMatch(Text(value, "sessionId"), "\\A[a-f0-9]{32}\\z") &&
            Regex.IsMatch(Text(value, "epoch"), "\\A[a-f0-9]{32}\\z") &&
            Regex.IsMatch(Text(value, "challenge"), "\\A[a-f0-9]{64}\\z"));
        Guid vm;
        Require(Guid.TryParseExact(Text(value, "vmId"), "D", out vm) && vm.ToString("D") == Text(value, "vmId") && vm != Guid.Empty);
        byte[] key = Convert.FromBase64String(Text(value, "key"));
        try { Require(key.Length == 32 && Convert.ToBase64String(key) == Text(value, "key")); }
        finally { Array.Clear(key, 0, key.Length); }
        Require(text == BindingJson(value));
        return value;
    }
    internal static byte[] ReadFrame(Stream stream, IntPtr pipe, int timeout)
    {
        var clock = Stopwatch.StartNew();
        byte[] header = ReadExact(stream, pipe, 4, clock, timeout);
        uint length = BitConverter.ToUInt32(header, 0);
        Require(length > 0 && length <= 4096, "frame-size");
        return ReadExact(stream, pipe, (int)length, clock, timeout);
    }
    private static byte[] ReadExact(Stream stream, IntPtr pipe, int length, Stopwatch clock, int timeout)
    {
        byte[] value = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            Require(clock.ElapsedMilliseconds < timeout, "frame-timeout");
            byte[] part = new byte[length - offset];
            int count = Native.ReadAvailable(stream, pipe, part);
            Require(count >= 0, "frame-input-unavailable");
            if (count > 0) { Buffer.BlockCopy(part, 0, value, offset, count); offset += count; }
            Array.Clear(part, 0, part.Length);
        }
        return value;
    }
    internal static void WriteFrame(Stream stream, byte[] value)
    {
        Require(value.Length > 0 && value.Length <= 4096);
        byte[] header = BitConverter.GetBytes((uint)value.Length);
        stream.Write(header, 0, 4); stream.Write(value, 0, value.Length); stream.Flush();
    }
    internal static string Evidence(Dictionary<string, object> value, Dictionary<string, object> pins)
    {
        foreach (string name in Pins) Require(Regex.IsMatch(Text(pins, name), "\\A[a-f0-9]{64}\\z"));
        return "{\"version\":1,\"sessionId\":\"" + Text(value, "sessionId") + "\",\"vmId\":\"" + Text(value, "vmId") +
            "\",\"epoch\":\"" + Text(value, "epoch") + "\",\"sequence\":1,\"challenge\":\"" + Text(value, "challenge") +
            "\",\"phase\":\"initialized\",\"imageSha256\":\"" + Text(pins, "imageSha256") +
            "\",\"runtimeSha256\":\"" + Text(pins, "runtimeSha256") + "\",\"principalSha256\":\"" + Text(pins, "principalSha256") +
            "\",\"jobSha256\":\"" + Text(pins, "jobSha256") + "\"}";
    }
    internal static byte[] Payload(byte[] key, string evidence)
    {
        using (var hmac = new HMACSHA256(key))
            return Utf8.GetBytes("{\"evidence\":" + evidence + ",\"mac\":\"" + Hex(hmac.ComputeHash(Utf8.GetBytes(evidence))) + "\"}");
    }
    internal sealed class Verifier
    {
        private readonly byte[] key;
        private readonly string expected;
        private bool consumed;
        internal Verifier(byte[] secret, string evidence) { key = (byte[])secret.Clone(); expected = evidence; }
        internal void Accept(byte[] payload)
        {
            Phase = "frame-consumption";
            Require(!consumed, "frame-consumed");
            Require(payload.Length <= 4096, "frame-size");
            byte[] wanted = Payload(key, expected);
            int difference = payload.Length ^ wanted.Length;
            Phase = "frame-authentication";
            for (int i = 0; i < wanted.Length; i++) difference |= wanted[i] ^ (i < payload.Length ? payload[i] : 0);
            Array.Clear(wanted, 0, wanted.Length);
            Require(difference == 0, "frame-authentication");
            consumed = true; Array.Clear(key, 0, key.Length);
        }
        internal void Close() { consumed = true; Array.Clear(key, 0, key.Length); }
    }
}
