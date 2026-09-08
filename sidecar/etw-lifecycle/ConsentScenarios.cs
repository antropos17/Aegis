using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record ConsentScenarioResult(bool Live, string Scenario, bool Passed,
    bool WitnessAuthenticated, bool RestrictedAcl, int? WitnessExitCode, bool BrokerExited,
    int? BrokerExitCode, ConsentResult? Result, TraceStats? Before, TraceStats? After, string? Error);

internal static class ConsentScenarios
{
    private static bool Absent(TraceStats? stats) => stats is
    {
        QueryStatus: 4201, EventsLost: null, RealTimeBuffersLost: null, LogBuffersLost: null,
        NumberOfBuffers: null, BufferSizeKiB: null, AbsentStatus: null
    };

    internal static bool Accepts(ConsentScenarioResult evidence)
    {
        var result = evidence.Result;
        if (result == null || evidence.Error != null || result.Error != null || result.Live != evidence.Live ||
            result.Scenario != evidence.Scenario || !result.RestrictedAcl || !result.LaunchReturned || result.AuthorizationSent ||
            !evidence.WitnessAuthenticated || !evidence.RestrictedAcl || evidence.WitnessExitCode != 0 ||
            !evidence.BrokerExited || evidence.BrokerExitCode != 0) return false;
        bool native = evidence.Live ? Absent(evidence.Before) && Absent(evidence.After) : evidence.Before == null && evidence.After == null;
        bool outcome = evidence.Scenario switch
        {
            "refusal" => result.Outcome == "uac-denied" && result.NativeError == 1223 &&
                !result.ChildLaunched && result.ChildExitCode == null && !result.ChildIdentityVerified &&
                result.InjectedDenial == !evidence.Live,
            "late" => result.Outcome == "late-consent" && result.ExpiredBeforeReturn && result.ChildLaunched &&
                result.ChildIdentityVerified && result.ChildExitCode == 2 && result.NativeError == null && !result.InjectedDenial &&
                result.LaunchElapsedMilliseconds >= (evidence.Live ? 5000 : 50),
            _ => false
        };
        return native && outcome;
    }

    internal static async Task<ConsentScenarioResult> Run(bool live, string scenario, CancellationToken cancellation = default)
    {
        if (scenario is not ("refusal" or "late")) throw new ArgumentException(nameof(scenario));
        Witness? witness = null; Process? broker = null;
        TraceStats? before = null, after = null; ConsentResult? result = null; string? error = null;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(live ? 140 : 30));
        try
        {
            witness = await Witness.Start(live, deadline.Token);
            before = await witness.Query("before", deadline.Token);
            if (live && !Absent(before)) throw new InvalidDataException();
            deadline.Token.ThrowIfCancellationRequested();
            if (live) Console.WriteLine(scenario == "refusal"
                ? "Witness ready. Reject the next UAC prompt (No)."
                : "Witness ready. Leave the next UAC prompt open for at least 10 seconds, then accept with the same account.");
            broker = Process.Start(Program.Child("consent-broker", live ? "live" : "check", scenario))
                ?? throw new InvalidOperationException();
            result = JsonSerializer.Deserialize<ConsentResult>(await Scenarios.Line(broker.StandardOutput, deadline.Token), Wire.Json)
                ?? throw new InvalidDataException();
            await broker.WaitForExitAsync(deadline.Token);
            after = await witness.Query("after", deadline.Token);
        }
        catch (Exception failure) { error = cancellation.IsCancellationRequested ? "cancelled" : Program.ErrorCode(failure); }
        finally
        {
            if (broker != null && !broker.HasExited)
            {
                // Only our normal broker. If consent is still pending, a late child has no surviving authorization server.
                broker.Kill(); await broker.WaitForExitAsync();
            }
            if (witness != null) await witness.Finish();
        }
        try
        {
            var evidence = new ConsentScenarioResult(live, scenario, false, witness?.Authenticated == true,
                witness?.RestrictedAcl == true, witness?.ExitCode, broker?.HasExited == true,
                broker?.HasExited == true ? broker.ExitCode : null, result, before, after, error);
            return evidence with { Passed = Accepts(evidence) };
        }
        finally { broker?.Dispose(); witness?.Dispose(); }
    }
}
