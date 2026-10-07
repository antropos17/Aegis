using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

// Fixed same-principal process fixture, outside packaging. No VM lifecycle API.
internal static class NativeBootstrapFixture
{
    internal static readonly string[] Modes = { "admit", "cancel", "close-job", "bad-mac", "cross-epoch", "oversized", "replay", "observer-loss", "timeout" };
    private static string Image() { return typeof(NativeBootstrapFixture).Assembly.Location; }
    private static string ExpectedRefusal(string mode)
    {
        if (mode == "bad-mac" || mode == "cross-epoch") return "frame-authentication";
        if (mode == "oversized") return "frame-size";
        if (mode == "replay") return "frame-consumed";
        if (mode == "observer-loss") return "observer-unavailable";
        if (mode == "timeout") return "frame-timeout";
        return null;
    }
    private static byte[] Framed(byte[] payload)
    {
        byte[] result = new byte[payload.Length + 4];
        Buffer.BlockCopy(BitConverter.GetBytes((uint)payload.Length), 0, result, 0, 4);
        Buffer.BlockCopy(payload, 0, result, 4, payload.Length);
        return result;
    }
    private static int Main(string[] args)
    {
        try
        {
            BootstrapWire.Require(args.Length == 2 && Array.IndexOf(Modes, args[1]) >= 0);
            if (args[0] == "--worker") return Worker(args[1]);
            BootstrapWire.Require(args[0] == "--fixture");
            return Supervisor(args[1]);
        }
        catch { Console.Error.WriteLine("native-bootstrap-unavailable:" + BootstrapWire.Phase); return 2; }
    }
    private static int Worker(string mode)
    {
        BootstrapWire.Phase = "worker-input";
        var input = Console.OpenStandardInput();
        BootstrapWire.WriteFrame(Console.OpenStandardOutput(), new byte[] { (byte)'B' });
        var binding = BootstrapWire.ReadBinding(input, Native.StandardInput());
        byte[] key = Convert.FromBase64String(BootstrapWire.Text(binding, "key"));
        try
        {
            BootstrapWire.Phase = "worker-pins";
            var pins = BootstrapWire.Json().Deserialize<Dictionary<string, object>>(
                BootstrapWire.Utf8.GetString(BootstrapWire.ReadFrame(input, Native.StandardInput(), 1000)));
            BootstrapWire.Require(pins.Count == 4 && BootstrapObservation.OwnJob());
            BootstrapWire.Phase = "worker-identity";
            BootstrapWire.Require(BootstrapWire.Text(pins, "imageSha256") == BootstrapWire.HashFile(Image()) &&
                BootstrapWire.Text(pins, "runtimeSha256") == BootstrapObservation.RuntimeHash() &&
                BootstrapWire.Text(pins, "principalSha256") == BootstrapObservation.OwnPrincipal());
            if (mode == "timeout") System.Threading.Thread.Sleep(3000);
            if (mode == "cross-epoch")
            {
                string epoch = BootstrapWire.Text(binding, "epoch");
                binding["epoch"] = (epoch[0] == '0' ? "1" : "0") + epoch.Substring(1);
            }
            string evidence = BootstrapWire.Evidence(binding, pins);
            byte[] payload = BootstrapWire.Payload(key, evidence);
            if (mode == "bad-mac") payload[payload.Length - 3] ^= 1;
            var output = Console.OpenStandardOutput();
            if (mode == "oversized") { byte[] header = BitConverter.GetBytes((uint)8192); output.Write(header, 0, 4); output.Flush(); }
            else BootstrapWire.WriteFrame(output, payload);
            // Only this fixed parent-owned anonymous input can release the one fixed task.
            byte[] release = BootstrapWire.ReadFrame(input, Native.StandardInput(), 3000);
            BootstrapWire.Require(release.Length == 1 && release[0] == (byte)'R');
            BootstrapWire.WriteFrame(output, new byte[] { (byte)'D' });
            return 0;
        }
        finally { Array.Clear(key, 0, key.Length); }
    }
    private static int Supervisor(string mode)
    {
        var binding = BootstrapWire.ReadBinding(Console.OpenStandardInput(), Native.StandardInput());
        byte[] key = Convert.FromBase64String(BootstrapWire.Text(binding, "key"));
        Native.Session child = null;
        Aegis.ProtectedSession.GuestJobInventory inventory = null;
        BootstrapWire.Verifier verifier = null;
        bool accepted = false, released = false, worked = false, empty = false, exited = false;
        string refusal = null;
        byte[] frame = null;
        Dictionary<string, object> pins = null;
        try
        {
          using (var pinned = new FileStream(Image(), FileMode.Open, FileAccess.Read, FileShare.Read))
          {
            string environment = "SystemRoot=" + Environment.GetEnvironmentVariable("SystemRoot") + "\0\0";
            BootstrapWire.Phase = "create-owned-child";
            child = Native.Start(Image(), Path.GetDirectoryName(Image()), new string[] { "--worker", mode }, environment);
            inventory = BootstrapObservation.RetainInventory(child, Image());
            pins = BootstrapObservation.Observe(child, Image(), inventory);
            uint initialActiveProcesses = BootstrapObservation.ActiveProcesses(child.Job);
            var workerPins = new Dictionary<string, object>();
            foreach (string name in BootstrapWire.Pins) workerPins.Add(name, pins[name]);
            verifier = new BootstrapWire.Verifier(key, BootstrapWire.Evidence(binding, workerPins));
            BootstrapWire.WriteFrame(child.Input, BootstrapWire.Utf8.GetBytes(BootstrapWire.BindingJson(binding)));
            BootstrapWire.WriteFrame(child.Input, BootstrapWire.Utf8.GetBytes(BootstrapWire.Json().Serialize(workerPins)));
            try
            {
                BootstrapWire.Phase = "frame-read";
                byte[] payload = BootstrapWire.ReadFrame(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), 2000);
                verifier.Accept(payload);
                if (mode == "replay") verifier.Accept(payload);
                var initialized = BootstrapObservation.Observe(child, Image(), inventory);
                foreach (var item in pins) BootstrapWire.Require((string)item.Value == (string)initialized[item.Key]);
                BootstrapWire.Require(mode != "observer-loss", "observer-unavailable");
                frame = Framed(payload);
                accepted = true;
            }
            catch (InvalidDataException error)
            {
                // Expected refusals remain observations. A ready-case failure is unavailable.
                if (ExpectedRefusal(mode) == null || error.Message != ExpectedRefusal(mode))
                {
                    byte[] diagnostic = new byte[256];
                    int count = Native.ReadAvailable(child.Error, child.Error.SafeFileHandle.DangerousGetHandle(), diagnostic);
                    if (count > 0)
                    {
                        string code = BootstrapWire.Utf8.GetString(diagnostic, 0, count).Trim();
                        foreach (string known in new string[] { "worker-input", "worker-pins", "worker-identity" })
                            if (code == "native-bootstrap-unavailable:" + known) BootstrapWire.Phase = known;
                    }
                    throw;
                }
                refusal = error.Message;
            }
            if (accepted && mode == "admit")
            {
                inventory.ValidateInitial();
                BootstrapWire.WriteFrame(child.Input, new byte[] { (byte)'R' });
                released = true;
                byte[] done = BootstrapWire.ReadFrame(child.Output, child.Output.SafeFileHandle.DangerousGetHandle(), 1000);
                BootstrapWire.Require(done.Length == 1 && done[0] == (byte)'D');
                worked = true;
            }
            if (mode == "close-job")
            {
                // The observer owns a duplicate Job handle; release it before
                // testing last-handle kill-on-close. No empty-Job claim survives.
                inventory.Dispose(); inventory = null;
                BootstrapWire.Require(BootstrapObservation.CloseHandle(child.Job));
                child.Job = IntPtr.Zero;
            }
            else empty = child.TerminateAndVerify() && inventory.ConfirmClosure(2000);
            exited = Native.WaitForSingleObject(child.Process, 2000) == 0;
            BootstrapWire.Require(exited && (mode == "close-job" || empty));
            var report = new Dictionary<string, object> {
                { "version", 1 }, { "scope", "native-bootstrap-process-fixture" }, { "mode", mode },
                { "initialized", accepted }, { "heldIdentityConfirmed", accepted }, { "inOwnedJob", true },
                { "samePrincipal", true }, { "jobKillOnClose", true },
                { "initialJobActiveProcesses", initialActiveProcesses }
            };
            foreach (var item in pins) report.Add(item.Key, item.Value);
            report.Add("payloadReleased", released); report.Add("workCompleted", worked);
            report.Add("childExited", exited); report.Add("jobEmpty", empty);
            BootstrapWire.Phase = "endpoint-codec";
            report.Add("endpointCodecPassed", HvEndpoint.SelfTest());
            report.Add("frameBase64", frame == null ? null : Convert.ToBase64String(frame));
            report.Add("refusalReason", refusal);
            Console.Out.WriteLine(BootstrapWire.Json().Serialize(report));
            return 0;
          }
        }
        finally
        {
            try
            {
                if (child != null)
                {
                    try { if (!exited) child.TerminateAndVerify(); }
                    finally { if (inventory != null) inventory.Dispose(); child.Dispose(); }
                }
            }
            finally
            {
                if (verifier != null) verifier.Close();
                Array.Clear(key, 0, key.Length);
            }
        }
    }
}
