namespace Aegis.EtwLifecycle;

internal static class PowerTests
{
    internal static Task NativeRegistration()
    {
        using var observer = new PowerObserver(false);
        observer.Arm();
        bool rejected = false;
        try { observer.Inject(PowerObserver.Capture(4)); }
        catch (InvalidOperationException) { rejected = true; }
        Check(rejected);
        observer.Dispose(); observer.Dispose();
        var record = observer.Snapshot();
        Check(record.Registered && !record.Synthetic && record.UnregisterStatus == 0 && record.ArmStamp != null);
        // Registration is a real native API check, never proof of an actual transition.
        return Task.CompletedTask;
    }

    private static PowerRecord ValidRecord()
    {
        var arm = new PowerStamp(0, DateTimeOffset.UtcNow, 100, 100);
        return new(false, true, true, false, null, 0, 1000, arm,
            [arm with { Type = 4, MonotonicTicks = 110, Awake100ns = 110 },
             arm with { Type = 18, MonotonicTicks = 200, Awake100ns = 120 }]);
    }

    internal static Task PairEvidence()
    {
        var valid = ValidRecord(); Check(PowerObserver.ValidPair(valid, true));
        foreach (var record in new[] {
            valid with { Synthetic = true }, valid with { Registered = false }, valid with { Armed = false },
            valid with { Overflow = true }, valid with { UnregisterStatus = null }, valid with { UnregisterStatus = 5 },
            valid with { Error = "power-callback-failed" }, valid with { Frequency = 0 }, valid with { ArmStamp = null },
            valid with { Events = [] }, valid with { Events = [valid.Events[0]] },
            valid with { Events = [valid.Events[1], valid.Events[0]] },
            valid with { Events = [valid.Events[0], valid.Events[1] with { Type = 7 }] },
            valid with { Events = [valid.Events[0], valid.Events[1] with { MonotonicTicks = 110 }] },
            valid with { Events = [valid.Events[0], valid.Events[1] with { Awake100ns = 109 }] },
            valid with { Events = [.. valid.Events, valid.Events[0] with { MonotonicTicks = 300, Awake100ns = 130 }] }
        }) Check(!PowerObserver.ValidPair(record, true));
        var simulated = valid with { Synthetic = true, Registered = false, UnregisterStatus = null };
        Check(PowerObserver.ValidPair(simulated, false));
        Check(!PowerObserver.ValidPair(simulated, true));
        // Wall-clock adjustments do not invalidate monotonic ordering.
        Check(PowerObserver.ValidPair(valid with { Events = [valid.Events[0], valid.Events[1] with { Utc = DateTimeOffset.MinValue }] }, true));
        return Task.CompletedTask;
    }

    internal static Task BoundedObserver()
    {
        using var observer = new PowerObserver(true); observer.Arm();
        for (int i = 0; i < 20; i++) observer.Inject(PowerObserver.Capture(i == 0 ? 4u : 18u));
        Check(observer.Snapshot() is { Overflow: true, Events.Length: 16 });
        observer.Dispose(); observer.Inject(PowerObserver.Capture(4));
        Check(observer.Snapshot().Events.Length == 16);
        using var stale = new PowerObserver(true); stale.Inject(PowerObserver.Capture(4));
        bool rejected = false; try { stale.Arm(); } catch (InvalidOperationException) { rejected = true; }
        Check(rejected);
        return Task.CompletedTask;
    }

    internal static Task CleanupEvidence()
    {
        var present = new TraceStats(0, 0, 0, 0, 256, 64);
        var absent = new TraceStats(4201, null, null, null, null, null);
        var cleanup = new BrokerResult(true, "suspend", true, true, "stop", 0, present, present with { AbsentStatus = 4201 }, true, true);
        var valid = new SuspendResult(true, false, true, true, true, 0, true, 0, true, true, 0,
            absent, present, absent, cleanup, ValidRecord(), null, null);
        Check(SuspendScenario.Accepts(valid));
        foreach (var result in new[] {
            valid with { ReadyForSleep = false }, valid with { StopRequested = false }, valid with { PeerIdentityVerified = false },
            valid with { PeerExitCode = null }, valid with { BrokerExited = false }, valid with { BrokerExitCode = 2 },
            valid with { WitnessAuthenticated = false }, valid with { RestrictedAcl = false }, valid with { WitnessExitCode = null },
            valid with { Preflight = present }, valid with { Before = absent }, valid with { After = null },
            valid with { After = absent with { EventsLost = 0 } }, valid with { Power = null },
            valid with { Cleanup = cleanup with { CleanupReceiptReceived = false } },
            valid with { Cleanup = cleanup with { FinalStats = null } },
            valid with { Cleanup = cleanup with { Scenario = "stop" } },
            valid with { Error = "timeout" }, valid with { FailureStage = "wait-resume" }
        }) Check(!SuspendScenario.Accepts(result));
        return Task.CompletedTask;
    }

    internal static async Task Cancelled()
    {
        using var abort = new CancellationTokenSource(); abort.Cancel();
        var result = await SuspendScenario.Run(true, abort.Token);
        Check(!result.Passed && !result.ReadyForSleep && !result.WitnessAuthenticated && result.Power == null && result.Error == "cancelled");
    }

    internal static async Task WitnessPhases()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var witness = await Witness.Start(false, deadline.Token, suspend: true);
        try
        {
            bool rejected = false;
            try { await witness.Query("before", deadline.Token); } catch (InvalidDataException) { rejected = true; }
            Check(rejected);
            foreach (string phase in new[] { "preflight", "before", "after" }) Check(await witness.Query(phase, deadline.Token) == null);
            rejected = false;
            try { await witness.Query("after", deadline.Token); } catch (InvalidDataException) { rejected = true; }
            Check(rejected);
        }
        finally { await witness.Finish(); }
        Check(witness.ExitCode == 0);
    }

    internal static async Task CancelAfterReady()
    {
        using var abort = new CancellationTokenSource();
        var result = await SuspendScenario.Run(false, abort.Token, () => abort.Cancel());
        Check(!result.Passed && result.ReadyForSleep && !result.StopRequested && result.Error == "cancelled" &&
            result.PeerIdentityVerified && result.PeerExitCode == 0 && result.BrokerExited &&
            result.BrokerExitCode == 0 && result.WitnessExitCode == 0 && result.Power is { Synthetic: true, Events.Length: 0 });
    }

    private static void Check(bool value) { if (!value) throw new InvalidOperationException("power-assertion-failed"); }
}
