using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record BrokerResult(bool Live, string Scenario, bool Authenticated, bool RestrictedAcl,
    string Outcome, int? PeerExitCode, TraceStats? InitialStats, TraceStats? FinalStats, bool StopAcknowledged,
    bool CleanupReceiptReceived = false);

internal static class Broker
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 3 || args[1] is not ("check" or "live") ||
            args[2] is not ("stop" or "parent-eof" or "broker-kill" or "peer-exit" or "peer-kill" or "lease" or "blocked-write" or "launch-denied")) throw new ArgumentException();
        bool live = args[1] == "live";
        if (Security.Current().Elevated || (live && args[2] is not ("stop" or "parent-eof" or "lease" or "blocked-write"))) return 3;
        string scenario = args[2], id = Guid.NewGuid().ToString("N");
        using var server = Security.Server(id);
        string receiptId = Guid.NewGuid().ToString("N");
        using var receipt = Security.Server(receiptId);
        bool acl = Security.RestrictedAcl(server) && Security.RestrictedAcl(receipt);
        if (!acl) throw new UnauthorizedAccessException();
        var self = Security.Current();
        string fault = scenario == "peer-exit" ? "exit" : scenario == "blocked-write" ? "flood" : "normal";
        var info = Program.Child("peer", args[1], id, self.Pid.ToString(CultureInfo.InvariantCulture), self.Birth.ToString(CultureInfo.InvariantCulture), fault, receiptId);
        if (live)
        {
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = false; info.RedirectStandardOutput = false; info.RedirectStandardError = false;
        }
        // Process.Start uses ShellExecuteEx with a retained process handle for runas.
        // The OS UAC prompt itself has no cancellable API here; no timer pretends it does.
        Process launched;
        try
        {
            if (scenario == "launch-denied") throw new System.ComponentModel.Win32Exception(1223); // explicit check-only injection
            launched = Process.Start(info) ?? throw new InvalidOperationException();
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new BrokerResult(live, scenario, false, acl,
                Program.ErrorCode(error), null, null, null, false)));
            return 2;
        }
        using var peer = launched;
        var identity = Security.Observe(peer);
        using var session = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        bool authenticated = false, stopped = false, cleanup = false;
        string outcome = "peer-failed";
        TraceStats? initial = null, final = null;
        ulong sent = 0, received = 0;
        try
        {
            await server.WaitForConnectionAsync(session.Token);
            Security.Verify(server, peer, identity.Birth, true, live);
            await receipt.WaitForConnectionAsync(session.Token);
            Security.Verify(receipt, peer, identity.Birth, true, live);
            authenticated = true;
            var hello = await Read();
            if (hello.Kind != "hello") throw new InvalidDataException();
            await Send("authorize");
            var ready = await Read();
            if (ready.Kind != "ready") throw new InvalidDataException();
            initial = ready.Stats;
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "ready", peerPid = peer.Id, peerBirth = identity.Birth.ToString(CultureInfo.InvariantCulture) }));
            if (scenario == "blocked-write")
            {
                // Read only the separate cleanup pipe below; primary stays blocked.
                outcome = "write-timeout";
            }
            else if (scenario is "lease" or "peer-exit" or "peer-kill")
            {
                if (scenario == "peer-kill") peer.Kill();
                var terminal = await Read();
                if (terminal.Kind != "stopped") throw new InvalidDataException();
                final = terminal.Stats; stopped = true; outcome = terminal.Code;
            }
            else
            {
                var input = Console.In.ReadLineAsync(session.Token).AsTask();
                while (!input.IsCompleted)
                {
                    var delay = Task.Delay(500, session.Token);
                    if (await Task.WhenAny(input, delay) == input) break;
                    await Send("ping");
                    if ((await Read()).Kind != "pong") throw new InvalidDataException();
                }
                string? command = await input;
                if (command != null && command != "stop") throw new InvalidDataException();
                await Send("stop", command == null ? "parent-eof" : "stop");
                var terminal = await Read();
                if (terminal.Kind != "stopped") throw new InvalidDataException();
                final = terminal.Stats; stopped = true; outcome = terminal.Code;
            }
            var confirmation = await Wire.Read(receipt, receiptId, live, session.Token);
            FinalEvidence.ValidateReceipt(confirmation, outcome, final, stopped);
            final = confirmation.Stats; cleanup = true;
            await peer.WaitForExitAsync(session.Token);
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or UnauthorizedAccessException)
        {
            outcome = Program.ErrorCode(error);
        }
        finally
        {
            server.Dispose(); // EOF is an independent collector cleanup trigger
            if (!peer.HasExited)
            {
                try { await peer.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7)); }
                catch (TimeoutException)
                {
                    outcome = "stop-unverified";
                    if (!live) { peer.Kill(); await peer.WaitForExitAsync(); }
                }
            }
        }
        int? exit = peer.HasExited ? peer.ExitCode : null;
        Console.WriteLine(JsonSerializer.Serialize(new BrokerResult(live, scenario, authenticated, acl, outcome, exit, initial, final, stopped, cleanup)));
        return 0;

        async Task<Frame> Read()
        {
            var frame = await Wire.Read(server, id, live, session.Token);
            Wire.Next(frame, ref received);
            return frame;
        }
        async Task Send(string kind, string code = "none")
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(session.Token);
            deadline.CancelAfter(TimeSpan.FromSeconds(2));
            await Wire.Write(server, Wire.Make(id, ++sent, kind, live, code), deadline.Token);
        }
    }
}
