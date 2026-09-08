using System.Text;
using System.Text.Json;
using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class WitnessTests
{
    internal static Task Evidence()
    {
        var present = new TraceStats(0, 0, 0, 0, 256, 64);
        var absent = new TraceStats(4201, null, null, null, null, null);
        var valid = new BrokerDeathResult(true, false, true, true, true, 0, true, true, 0, present, absent, null);
        Check(BrokerDeath.Accepts(valid));
        foreach (var result in new[] {
            valid with { BrokerKilled = false }, valid with { BrokerExited = false },
            valid with { PeerIdentityVerified = false }, valid with { PeerExitCode = null },
            valid with { PeerExitCode = 9 }, valid with { WitnessAuthenticated = false },
            valid with { RestrictedAcl = false }, valid with { WitnessExitCode = null },
            valid with { WitnessExitCode = 2 }, valid with { Before = null },
            valid with { Before = absent }, valid with { Before = present with { EventsLost = null } },
            valid with { After = null }, valid with { After = present },
            valid with { After = absent with { QueryStatus = 5 } },
            valid with { After = absent with { EventsLost = 0 } }, valid with { Error = "timeout" },
            valid with { FailureStage = "query-after" },
            valid with { Live = false }
        }) Check(!BrokerDeath.Accepts(result));
        var simulated = valid with { Live = false, Before = null, After = null };
        Check(BrokerDeath.Accepts(simulated));
        Check(!BrokerDeath.Accepts(simulated with { Live = true }));
        return Task.CompletedTask;
    }

    internal static Task Protocol()
    {
        string id = Guid.NewGuid().ToString("N");
        var query = new WitnessFrame("etw-witness/1", id, "before", true, false, null);
        Witness.Validate(query, id, "before", true, false);
        foreach (var frame in new[] {
            query with { Protocol = "etw-lifecycle/2" }, query with { Id = Guid.NewGuid().ToString("N") },
            query with { Phase = "after" }, query with { Reply = true }, query with { Live = false },
            query with { Stats = new TraceStats(0, 0, 0, 0, 256, 64) }
        }) Reject(() => Witness.Validate(frame, id, "before", true, false));
        var reply = query with { Reply = true, Live = false };
        Witness.Validate(reply, id, "before", false, true);
        Reject(() => Witness.Validate(reply with { Stats = new TraceStats(4201, null, null, null, null, null) }, id, "before", false, true));
        Reject(() => Witness.Validate(query with { Phase = "stop" }, id, "stop", true, false));
        return Task.CompletedTask;
    }

    internal static async Task Cancelled()
    {
        using var abort = new CancellationTokenSource(); abort.Cancel();
        var result = await BrokerDeath.Run(false, abort.Token);
        Check(!result.Passed && !result.BrokerKilled && !result.PeerIdentityVerified && result.Error == "cancelled");
    }

    internal static async Task Framing()
    {
        string id = Guid.NewGuid().ToString("N");
        var query = new WitnessFrame("etw-witness/1", id, "before", false, false, null);
        using var bytes = new MemoryStream();
        await Witness.Write(bytes, query, CancellationToken.None); bytes.Position = 0;
        using var reader = new StreamReader(bytes, new UTF8Encoding(false, true));
        Check(await Witness.Read(reader, id, "before", false, false, CancellationToken.None) == query);
        foreach (string body in new[] { "{}\n", "null\n", new string('x', 4096) + "\n",
            JsonSerializer.Serialize(query, Wire.Json),
            JsonSerializer.Serialize(query, Wire.Json)[..^1] + ",\"Unexpected\":1}\n" })
        {
            using var input = new MemoryStream(Encoding.UTF8.GetBytes(body));
            using var invalid = new StreamReader(input, new UTF8Encoding(false, true));
            bool rejected = false;
            try { await Witness.Read(invalid, id, "before", false, false, CancellationToken.None); }
            catch (Exception error) when (error is IOException or InvalidDataException or JsonException) { rejected = true; }
            Check(rejected);
        }
    }

    internal static async Task HeldProcess()
    {
        string id = Guid.NewGuid().ToString("N");
        using var child = Process.Start(Program.Child("rogue", "server", id)) ?? throw new InvalidOperationException();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            Check(await Scenarios.Line(child.StandardOutput, deadline.Token) == "ready");
            using var observed = new ObservedProcess(child.Id);
            Check(observed.Identity.Birth == Security.Observe(child).Birth && !observed.HasExited && observed.ExitCode == null);
            child.Kill(); await child.WaitForExitAsync(deadline.Token);
            await observed.WaitForExit(deadline.Token);
            Check(observed.ExitCode == child.ExitCode && observed.HasExited);
        }
        finally { if (!child.HasExited) child.Kill(); await child.WaitForExitAsync(); }
    }

    private static void Check(bool value) { if (!value) throw new InvalidOperationException("witness-assertion-failed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (InvalidDataException) { return; }
        throw new InvalidOperationException("witness-rejection-required");
    }
}
