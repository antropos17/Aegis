using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record ScenarioResult(string Scenario, bool Passed, bool PeerExited,
    bool BrokerExited, BrokerResult? Result, string? Error);

internal static class Scenarios
{
    internal static async Task<ScenarioResult> Run(bool live, string scenario, CancellationToken cancellation = default)
    {
        using var broker = Process.Start(Program.Child("broker", live ? "live" : "check", scenario)) ?? throw new InvalidOperationException();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(live ? 150 : 35));
        Process? peer = null;
        try
        {
            string ready = await Line(broker.StandardOutput, timeout.Token);
            using var json = JsonDocument.Parse(ready);
            if (!json.RootElement.TryGetProperty("kind", out _))
            {
                var failed = JsonSerializer.Deserialize<BrokerResult>(ready, Wire.Json) ?? throw new InvalidDataException();
                await broker.WaitForExitAsync(timeout.Token);
                bool expectedDenial = !live && scenario == "launch-denied" && failed.Outcome == "uac-denied" &&
                    !failed.Authenticated && failed.PeerExitCode == null && !failed.StopAcknowledged;
                return new(scenario, expectedDenial, false, true, failed, failed.Outcome);
            }
            if (json.RootElement.GetProperty("kind").GetString() != "ready") throw new InvalidDataException();
            if (scenario == "broker-kill")
            {
                peer = Process.GetProcessById(json.RootElement.GetProperty("peerPid").GetInt32());
                var identity = Security.Observe(peer); // hold THIS child instance before killing its broker
                if (identity.Birth.ToString(System.Globalization.CultureInfo.InvariantCulture) != json.RootElement.GetProperty("peerBirth").GetString()) throw new InvalidDataException();
                broker.Kill();
                await broker.WaitForExitAsync(timeout.Token);
                await peer.WaitForExitAsync(timeout.Token);
                return new(scenario, peer.ExitCode == 0, true, true, null, null);
            }
            if (scenario == "stop") await broker.StandardInput.WriteLineAsync("stop");
            else if (scenario == "parent-eof") broker.StandardInput.Close();
            string summary = await Line(broker.StandardOutput, timeout.Token);
            var result = JsonSerializer.Deserialize<BrokerResult>(summary, Wire.Json) ?? throw new InvalidDataException();
            await broker.WaitForExitAsync(timeout.Token);
            return new(scenario, FinalEvidence.Accepts(live, scenario, result, broker.ExitCode),
                result.PeerExitCode.HasValue, true, result, null);
        }
        catch (Exception error)
        {
            await Cleanup();
            // Only bounded static diagnostics cross into result.json.
            return new(scenario, false, peer?.HasExited == true, broker.HasExited, null,
                cancellation.IsCancellationRequested ? "cancelled" : Program.ErrorCode(error));
        }
        finally
        {
            await Cleanup();
            peer?.Dispose();
        }

        async Task Cleanup()
        {
            if (!broker.HasExited)
            {
                broker.StandardInput.Close();
                try { await broker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7)); }
                catch (TimeoutException) { broker.Kill(); await broker.WaitForExitAsync(); }
            }
            if (peer != null && !peer.HasExited) { peer.Kill(); await peer.WaitForExitAsync(); }
        }
    }

    internal static async Task<string> Line(StreamReader reader, CancellationToken token)
    {
        var text = new System.Text.StringBuilder(); var buffer = new char[1];
        while (text.Length < 4096)
        {
            if (await reader.ReadAsync(buffer, token) == 0) throw new EndOfStreamException();
            if (buffer[0] == '\n') return text.ToString().TrimEnd('\r');
            text.Append(buffer[0]);
        }
        throw new InvalidDataException();
    }
}
