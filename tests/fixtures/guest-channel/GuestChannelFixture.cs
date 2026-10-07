using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;

internal static class GuestChannelFixture
{
    private static readonly string[] Modes = { "admit", "cancel", "bad-command", "cross-epoch-command", "wrong-direction-command", "replay-command", "bad-result", "oversized-result", "timeout" };
    private static string Image() { return typeof(GuestChannelFixture).Assembly.Location; }
    private static string Refusal(string mode)
    {
        if (mode == "bad-command" || mode == "bad-result") return "channel-authentication";
        if (mode == "cross-epoch-command" || mode == "wrong-direction-command") return "channel-context";
        if (mode == "replay-command") return "channel-sequence";
        if (mode == "oversized-result") return "frame-size";
        if (mode == "timeout") return "frame-timeout";
        return null;
    }
    private static byte[] Framed(byte[] payload)
    {
        byte[] result = new byte[payload.Length + 4];
        Buffer.BlockCopy(BitConverter.GetBytes((uint)payload.Length), 0, result, 0, 4);
        Buffer.BlockCopy(payload, 0, result, 4, payload.Length); return result;
    }
    private static byte[] Changed(byte[] payload, byte[] key, string before, string after)
    {
        string text = BootstrapWire.Utf8.GetString(payload);
        int macStart = text.LastIndexOf(",\"mac\":", StringComparison.Ordinal);
        BootstrapWire.Require(macStart > 0);
        string value = (text.Substring(0, macStart) + "}").Replace(before, after);
        using (var hmac = new HMACSHA256(key))
        {
            string mac = BootstrapWire.Hex(hmac.ComputeHash(BootstrapWire.Utf8.GetBytes(value)));
            return BootstrapWire.Utf8.GetBytes(value.Substring(0, value.Length - 1) + ",\"mac\":\"" + mac + "\"}");
        }
    }
    private static void BadMac(byte[] payload) { int at = payload.Length - 3; payload[at] = payload[at] == (byte)'0' ? (byte)'1' : (byte)'0'; }
    private static int Main(string[] args)
    {
        bool worker = args.Length == 2 && args[0] == "--worker";
        try
        {
            BootstrapWire.Require(args.Length == 2 && Array.IndexOf(Modes, args[1]) >= 0);
            if (worker) return Worker(args[1]);
            BootstrapWire.Require(args[0] == "--fixture"); return Supervisor(args[1]);
        }
        catch (InvalidDataException error)
        {
            if (worker && error.Message == Refusal(args[1]) && error.Message.StartsWith("channel-", StringComparison.Ordinal))
                Console.Error.WriteLine("guest-channel-refused:" + error.Message);
            else Console.Error.WriteLine("native-bootstrap-unavailable:" + BootstrapWire.Phase);
            return 2;
        }
        catch { Console.Error.WriteLine("native-bootstrap-unavailable:" + BootstrapWire.Phase); return 2; }
    }
    private static void Tools(Dictionary<string, object> tools)
    {
        BootstrapWire.Require(tools != null && tools.Count == 4);
        foreach (string prefix in new string[] { "node", "git" })
        {
            string selected = BootstrapWire.Text(tools, prefix + "Path");
            BootstrapWire.Require(selected.Length <= 512 && selected.Length > 3 && selected[1] == ':' && Path.IsPathRooted(selected) &&
                string.Equals(Path.GetExtension(selected), ".exe", StringComparison.OrdinalIgnoreCase));
            BootstrapWire.Require(BootstrapWire.Text(tools, prefix + "Sha256") == BootstrapWire.HashFile(selected));
        }
    }
    private static int Worker(string mode)
    {
        var input = Console.OpenStandardInput(); var output = Console.OpenStandardOutput();
        BootstrapWire.WriteFrame(output, new byte[] { (byte)'B' });
        var binding = BootstrapWire.ReadBinding(input, Native.StandardInput());
        byte[] key = Convert.FromBase64String(BootstrapWire.Text(binding, "key"));
        try
        {
            var pins = BootstrapWire.Json().Deserialize<Dictionary<string, object>>(BootstrapWire.Utf8.GetString(BootstrapWire.ReadFrame(input, Native.StandardInput(), 1000)));
            BootstrapWire.Require(pins != null && pins.Count == 8 && BootstrapObservation.OwnJob());
            BootstrapWire.Require(BootstrapWire.Text(pins, "imageSha256") == BootstrapWire.HashFile(Image()) &&
                BootstrapWire.Text(pins, "runtimeSha256") == BootstrapObservation.RuntimeHash() &&
                BootstrapWire.Text(pins, "principalSha256") == BootstrapObservation.OwnPrincipal());
            var tools = new Dictionary<string, object>();
            foreach (string name in new string[] { "nodePath", "nodeSha256", "gitPath", "gitSha256" }) tools.Add(name, pins[name]);
            Tools(tools);
            BootstrapWire.WriteFrame(output, BootstrapWire.Payload(key, BootstrapWire.Evidence(binding, pins)));
            using (var channel = new GuestChannelWire(key, binding, false))
            {
                byte[] command = BootstrapWire.ReadFrame(input, Native.StandardInput(), 3000); string operation;
                channel.Accept(command, out operation);
                if (mode == "replay-command") channel.Accept(command, out operation);
                if (operation == "cancel")
                {
                    BootstrapWire.WriteFrame(output, channel.Send("stopped", new byte[] { (byte)'S' })); return 0;
                }
                BootstrapWire.Require(operation == "release");
                if (mode == "timeout") System.Threading.Thread.Sleep(3000);
                byte[] result = GuestFixedTask.Execute(Image(), mode, BootstrapWire.Text(tools, "nodePath"), BootstrapWire.Text(tools, "gitPath"));
                byte[] evidence = channel.Send("result", result);
                if (mode == "bad-result") BadMac(evidence);
                if (mode == "oversized-result") { byte[] size = BitConverter.GetBytes((uint)4097); output.Write(size, 0, 4); output.Flush(); }
                else BootstrapWire.WriteFrame(output, evidence);
                BootstrapWire.WriteFrame(output, channel.Send("stopped", new byte[] { (byte)'S' })); return 0;
            }
        }
        finally { Array.Clear(key, 0, key.Length); }
    }
    private static void ConfirmWorkerRefusal(Native.Session child, string expected)
    {
        BootstrapWire.Require(Native.WaitForSingleObject(child.Process, 2000) == 0 && child.ExitCode() == 2);
        var text = new System.Text.StringBuilder(); var clock = Stopwatch.StartNew();
        byte[] part = new byte[256];
        while (clock.ElapsedMilliseconds < 500)
        {
            int count = Native.ReadAvailable(child.Error, child.Error.SafeFileHandle.DangerousGetHandle(), part);
            if (count < 0) break;
            if (count > 0) { BootstrapWire.Require(text.Length + count <= 512); text.Append(BootstrapWire.Utf8.GetString(part, 0, count)); }
        }
        BootstrapWire.Require(text.ToString() == "guest-channel-refused:" + expected + Environment.NewLine);
    }
    private static bool TaskObserved(string mode)
    {
        string root = GuestFixedTask.Root(Image(), mode);
        if (!Directory.Exists(root)) return false;
        return File.ReadAllText(Path.Combine(root, "source.txt"), BootstrapWire.Utf8) == GuestFixedTask.After &&
            File.ReadAllText(Path.Combine(root, "fixture.test.cjs"), BootstrapWire.Utf8) == GuestFixedTask.Test &&
            File.Exists(Path.Combine(root, ".git", "index")) &&
            File.ReadAllText(Path.Combine(root, ".git", "HEAD"), BootstrapWire.Utf8) == "ref: refs/heads/fixture\n";
    }
    private static int Supervisor(string mode)
    {
        var input = Console.OpenStandardInput();
        var binding = BootstrapWire.ReadBinding(input, Native.StandardInput());
        var tools = BootstrapWire.Json().Deserialize<Dictionary<string, object>>(BootstrapWire.Utf8.GetString(BootstrapWire.ReadFrame(input, Native.StandardInput(), 1000)));
        byte[] requested = BootstrapWire.ReadFrame(input, Native.StandardInput(), 1000);
        byte[] key = Convert.FromBase64String(BootstrapWire.Text(binding, "key"));
        Native.Session child = null; bool exited = false;
        Aegis.ProtectedSession.GuestJobInventory inventory = null;
        try
        {
          Tools(tools);
          using (var imagePin = new FileStream(Image(), FileMode.Open, FileAccess.Read, FileShare.Read))
          using (var nodePin = new FileStream(BootstrapWire.Text(tools, "nodePath"), FileMode.Open, FileAccess.Read, FileShare.Read))
          using (var gitPin = new FileStream(BootstrapWire.Text(tools, "gitPath"), FileMode.Open, FileAccess.Read, FileShare.Read))
          using (var channel = new GuestChannelWire(key, binding, true))
          using (var initializedVerifier = new VerifierLease(key))
          {
            Tools(tools);
            BootstrapWire.Phase = "guest-child-create";
            child = Native.Start(Image(), Path.GetDirectoryName(Image()), new string[] { "--worker", mode }, "SystemRoot=" + Environment.GetEnvironmentVariable("SystemRoot") + "\0\0");
            inventory = BootstrapObservation.RetainInventory(child, Image());
            var pins = BootstrapObservation.Observe(child, Image(), inventory);
            uint initialCount = BootstrapObservation.ActiveProcesses(child.Job);
            var workerPins = new Dictionary<string, object>();
            foreach (string name in BootstrapWire.Pins) workerPins.Add(name, pins[name]);
            foreach (var item in tools) workerPins.Add(item.Key, item.Value);
            BootstrapWire.WriteFrame(child.Input, BootstrapWire.Utf8.GetBytes(BootstrapWire.BindingJson(binding)));
            BootstrapWire.WriteFrame(child.Input, BootstrapWire.Utf8.GetBytes(BootstrapWire.Json().Serialize(workerPins)));
            byte[] initialized = BootstrapWire.ReadFrame(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), 2000);
            initializedVerifier.Accept(initialized, BootstrapWire.Evidence(binding, workerPins));
            var observed = BootstrapObservation.Observe(child, Image(), inventory);
            foreach (var item in pins) BootstrapWire.Require((string)item.Value == (string)observed[item.Key]);
            byte[] command = channel.Send(mode == "cancel" ? "cancel" : "release", new byte[] { mode == "cancel" ? (byte)'C' : (byte)'R' });
            BootstrapWire.Require(Convert.ToBase64String(command) == Convert.ToBase64String(requested));
            if (mode == "bad-command") BadMac(command);
            if (mode == "cross-epoch-command")
            {
                string epoch = BootstrapWire.Text(binding, "epoch");
                command = Changed(command, key, epoch, (epoch[0] == '0' ? "1" : "0") + epoch.Substring(1));
            }
            if (mode == "wrong-direction-command") command = Changed(command, key, "host-to-guest", "guest-to-host");
            inventory.ValidateInitial();
            BootstrapWire.WriteFrame(child.Input, command);
            byte[] resultFrame = null, stoppedFrame = null; string refusal = null, operation;
            try
            {
                byte[] response = BootstrapWire.ReadFrame(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), mode == "timeout" ? 1000 : 6000);
                channel.Accept(response, out operation);
                if (mode != "cancel")
                {
                    BootstrapWire.Require(operation == "result"); resultFrame = Framed(response);
                    response = BootstrapWire.ReadFrame(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), 1000);
                    channel.Accept(response, out operation);
                }
                BootstrapWire.Require(operation == "stopped"); stoppedFrame = Framed(response);
            }
            catch (InvalidDataException error)
            {
                string expected = Refusal(mode);
                if (expected == null)
                {
                    byte[] diagnostic = new byte[256];
                    int count = Native.ReadAvailable(child.Error, child.Error.SafeFileHandle.DangerousGetHandle(), diagnostic);
                    if (count > 0)
                    {
                        string text = BootstrapWire.Utf8.GetString(diagnostic, 0, count).Trim();
                        foreach (string phase in new string[] { "task-git-init", "task-git-add", "task-git-commit", "task-node-test", "task-git-diff" })
                            if (text == "native-bootstrap-unavailable:" + phase) BootstrapWire.Phase = phase;
                    }
                    throw;
                }
                if (mode.EndsWith("command", StringComparison.Ordinal))
                {
                    BootstrapWire.Require(error.Message == "frame-input-unavailable"); ConfirmWorkerRefusal(child, expected);
                }
                else BootstrapWire.Require(error.Message == expected);
                refusal = expected;
            }
            bool empty = child.TerminateAndVerify() && inventory.ConfirmClosure(2000); exited = Native.WaitForSingleObject(child.Process, 2000) == 0;
            BootstrapWire.Require(empty && exited);
            var report = new Dictionary<string, object> {
                { "version", 1 }, { "scope", "guest-channel-process-fixture" }, { "mode", mode },
                { "initialized", true }, { "initialJobActiveProcesses", initialCount },
                { "taskObserved", TaskObserved(mode) }, { "resultAccepted", resultFrame != null }, { "stopMessageAccepted", stoppedFrame != null },
                { "childExited", exited }, { "jobEmpty", empty }, { "refusalReason", refusal },
                { "initializedFrameBase64", Convert.ToBase64String(Framed(initialized)) },
                { "resultFrameBase64", resultFrame == null ? null : Convert.ToBase64String(resultFrame) },
                { "stoppedFrameBase64", stoppedFrame == null ? null : Convert.ToBase64String(stoppedFrame) }
            };
            foreach (var item in pins) report.Add(item.Key, item.Value);
            report.Add("nodeSha256", tools["nodeSha256"]); report.Add("gitSha256", tools["gitSha256"]);
            BootstrapWire.Phase = "guest-report";
            string json = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 8 }.Serialize(report);
            BootstrapWire.Require(BootstrapWire.Utf8.GetByteCount(json) <= 16384);
            Console.Out.WriteLine(json); return 0;
          }
        }
        finally
        {
            try { if (child != null) { try { if (!exited) child.TerminateAndVerify(); } finally { if (inventory != null) inventory.Dispose(); child.Dispose(); } } }
            finally { Array.Clear(key, 0, key.Length); }
        }
    }
    private sealed class VerifierLease : IDisposable
    {
        private readonly byte[] key;
        private BootstrapWire.Verifier verifier;
        internal VerifierLease(byte[] value) { key = (byte[])value.Clone(); }
        internal void Accept(byte[] value, string expected) { verifier = new BootstrapWire.Verifier(key, expected); verifier.Accept(value); }
        public void Dispose() { if (verifier != null) verifier.Close(); Array.Clear(key, 0, key.Length); }
    }
}
