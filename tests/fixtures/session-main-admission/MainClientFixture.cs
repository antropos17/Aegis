using System;
using System.IO;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class MainClientFixture
{
    internal static void Run(string root)
    {
        string[] route = File.ReadAllLines(Path.Combine(root, "fixture-route.txt"));
        string control = route[0], locator = route[1], session = route[2], generation = route[3], mode = route[4];
        using (var imported = new SafeFileHandle(new IntPtr(Int64.Parse(route[5])), true))
        using (var server = new CallerRegistration(imported.DangerousGetHandle(), session))
        using (var pipe = CallerEndpoint.ConnectLocal(locator, server, 1000))
        {
            string role = route[6] == "legacy" ? "" : "\"role\":\"controller-main\",";
            string selection = route[6] == "legacy" ? "" : ",\"selectionId\":\"" + new string('c', 32) +
                "\",\"inventoryRevision\":1,\"selectionEpoch\":\"" + new string('d', 32) + "\"";
            string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1," + role +
                "\"operation\":\"inspect-owned\",\"requestId\":\"" + new string('e', 32) + "\",\"sessionId\":\"" + session +
                "\",\"generation\":\"" + generation + "\"" + selection + ",\"sequence\":1}";
            if (mode == "frame-role") json = json.Replace("controller-main", "broker");
            if (mode == "frame-generation") json = json.Replace(generation, new string('f', 32));
            if (mode == "unknown-selection") json = json.Replace(new string('c', 32), new string('f', 32));
            if (mode == "stale-selection") json = json.Replace(new string('d', 32), new string('f', 32));
            if (mode == "stale-revision") json = json.Replace("\"inventoryRevision\":1", "\"inventoryRevision\":2");
            byte[] body = Encoding.UTF8.GetBytes(json), wire = new byte[body.Length + 4];
            Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, wire, 0, 4); Buffer.BlockCopy(body, 0, wire, 4, body.Length);
            uint written; CallerNative.Require(CallerEndpointNative.WriteFile(pipe, wire, (uint)wire.Length, out written, IntPtr.Zero) && written == wire.Length);
            File.WriteAllText(Path.Combine(control, "client-ready.txt"), "actual-held-server-verified");
            MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "close-client.txt")));
        }
    }
}
