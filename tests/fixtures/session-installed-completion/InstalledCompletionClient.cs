using System;
using System.IO;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Same genuine held-server/native message admission as MainClientFixture, with
// a separate pipe-close acknowledgement while the registered process stays live.
internal static class InstalledCompletionClient
{
    internal static void Run(string root)
    {
        string[] route = File.ReadAllLines(Path.Combine(root, "fixture-route.txt"));
        string control = route[0], session = route[2], generation = route[3];
        using (var imported = new SafeFileHandle(new IntPtr(Int64.Parse(route[5])), true))
        using (var server = new CallerRegistration(imported.DangerousGetHandle(), session))
        {
            using (var pipe = CallerEndpoint.ConnectLocal(route[1], server, 1000))
            {
                string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"role\":\"controller-main\",\"operation\":\"inspect-owned\",\"requestId\":\"" +
                    new string('e', 32) + "\",\"sessionId\":\"" + session + "\",\"generation\":\"" + generation +
                    "\",\"selectionId\":\"" + new string('c', 32) + "\",\"inventoryRevision\":1,\"selectionEpoch\":\"" + new string('d', 32) + "\",\"sequence\":1}";
                byte[] body = Encoding.UTF8.GetBytes(json), wire = new byte[body.Length + 4];
                Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, wire, 0, 4); Buffer.BlockCopy(body, 0, wire, 4, body.Length);
                uint written;
                CallerNative.Require(CallerEndpointNative.WriteFile(pipe, wire, (uint)wire.Length, out written, IntPtr.Zero) && written == wire.Length);
                File.WriteAllText(Path.Combine(control, "client-ready.txt"), "actual-held-server-and-native-pipe");
                MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "close-client.txt")) || File.Exists(Path.Combine(control, "close-pipe.txt")));
            }
            File.WriteAllText(Path.Combine(control, "client-pipe-closed.txt"), "registered-process-still-live");
            MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "close-client.txt")));
        }
    }
}
