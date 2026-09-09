using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record SuspendResult(bool Live, bool Passed, bool ReadyForSleep, bool StopRequested,
    bool PeerIdentityVerified, int? PeerExitCode, bool BrokerExited, int? BrokerExitCode,
    bool WitnessAuthenticated, bool RestrictedAcl, int? WitnessExitCode,
    TraceStats? Preflight, TraceStats? Before, TraceStats? After, BrokerResult? Cleanup,
    PowerRecord? Power, string? Error, string? FailureStage);

internal static class SuspendScenario
{
    private static bool Absent(TraceStats? stats) => stats is
    {
        QueryStatus: 4201, EventsLost: null, RealTimeBuffersLost: null, LogBuffersLost: null,
        NumberOfBuffers: null, BufferSizeKiB: null, AbsentStatus: null
    };
    private static bool Present(TraceStats? stats) => stats is
    {
        QueryStatus: 0, EventsLost: not null, RealTimeBuffersLost: not null, LogBuffersLost: not null,
        NumberOfBuffers: > 0, BufferSizeKiB: > 0, AbsentStatus: null
    };

    internal static bool Accepts(SuspendResult result)
    {
        if (!result.ReadyForSleep || !result.StopRequested || !result.PeerIdentityVerified || result.PeerExitCode != 0 ||
            !result.BrokerExited || result.BrokerExitCode != 0 || !result.WitnessAuthenticated || !result.RestrictedAcl ||
            result.WitnessExitCode != 0 || result.Error != null || result.FailureStage != null || result.Power == null ||
            !PowerObserver.ValidPair(result.Power, result.Live) || result.Cleanup is not { Scenario: "suspend" } cleanup) return false;
        // Suspend deliberately requests the existing owned stop. Validate its full
        // receipt/counters contract while preserving the actual scenario in the report.
        if (!FinalEvidence.Accepts(result.Live, "stop", cleanup with { Scenario = "stop" }, 0)) return false;
        return result.Live ? Absent(result.Preflight) && Present(result.Before) && Absent(result.After)
            : result.Preflight == null && result.Before == null && result.After == null;
    }

    internal static async Task<SuspendResult> Run(bool live, CancellationToken cancellation = default, Action? afterArmForTest = null)
    {
        if (live && afterArmForTest != null) throw new ArgumentException("live-test-hook-forbidden");
        Witness? witness = null; Process? broker = null; ObservedProcess? peer = null; PowerObserver? power = null;
        TraceStats? preflight = null, before = null, after = null; BrokerResult? cleanup = null;
        bool ready = false, stopRequested = false, identity = false, beforeQueried = false;
        string? error = null, failureStage = null; string stage = "power-register";
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(live ? 480 : 35));
        try
        {
            deadline.Token.ThrowIfCancellationRequested();
            power = new PowerObserver(!live);
            stage = "witness-launch";
            witness = await Witness.Start(live, deadline.Token, suspend: true);
            preflight = await witness.Query("preflight", deadline.Token);
            if (live && !Absent(preflight)) throw new InvalidDataException();
            deadline.Token.ThrowIfCancellationRequested();
            stage = "broker-ready";
            broker = Process.Start(Program.Child("broker", live ? "live" : "check", "suspend")) ?? throw new InvalidOperationException();
            using var message = JsonDocument.Parse(await Scenarios.Line(broker.StandardOutput, deadline.Token));
            if (!message.RootElement.TryGetProperty("kind", out var kind) || kind.GetString() != "ready") throw new InvalidDataException();
            stage = "collector-identity";
            peer = new ObservedProcess(message.RootElement.GetProperty("peerPid").GetInt32());
            var actual = peer.Identity; var self = Security.Current();
            identity = actual.Birth.ToString(CultureInfo.InvariantCulture) == message.RootElement.GetProperty("peerBirth").GetString() &&
                actual.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase) && actual.User == self.User &&
                actual.Logon == self.Logon && actual.Elevated == live;
            if (!identity) throw new UnauthorizedAccessException();
            stage = "query-before";
            before = await witness.Query("before", deadline.Token); beforeQueried = true;
            if (live && !Present(before)) throw new InvalidDataException();
            if (peer.HasExited || broker.HasExited) throw new InvalidDataException();
            stage = "power-arm";
            power.Arm(); ready = true;
            afterArmForTest?.Invoke();
            deadline.Token.ThrowIfCancellationRequested();
            if (live) Console.WriteLine("READY FOR MANUAL SLEEP. Use Windows Sleep, then wake this computer. Do not hibernate for this first run. No automatic sleep or restart will occur.");
            else power.Inject(PowerObserver.Capture(4)); // Explicit check-only fixture, never native power evidence.
            stage = "wait-suspend";
            var brokerExit = broker.WaitForExitAsync(deadline.Token);
            if (await Task.WhenAny(power.Suspend.Task, brokerExit).WaitAsync(deadline.Token) == brokerExit) throw new InvalidDataException();
            await power.Suspend.Task.WaitAsync(deadline.Token);
            stage = "request-owned-stop";
            await broker.StandardInput.WriteLineAsync("stop".AsMemory(), deadline.Token);
            await broker.StandardInput.FlushAsync(deadline.Token); stopRequested = true;
            if (!live) power.Inject(PowerObserver.Capture(18));
            stage = "wait-resume";
            await power.Resume.Task.WaitAsync(deadline.Token);
            stage = "cleanup-receipt";
            cleanup = JsonSerializer.Deserialize<BrokerResult>(await Scenarios.Line(broker.StandardOutput, deadline.Token), Wire.Json)
                ?? throw new InvalidDataException();
            await brokerExit; await peer.WaitForExit(deadline.Token);
            stage = "query-after";
            // A successful pair alone never establishes session cleanup.
            beforeQueried = false; after = await witness.Query("after", deadline.Token);
        }
        catch (Exception failure)
        {
            error = cancellation.IsCancellationRequested ? "cancelled" : Program.ErrorCode(failure); failureStage = stage;
        }
        finally
        {
            if (broker != null && !broker.HasExited)
            {
                broker.StandardInput.Close();
                try { await broker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7)); }
                catch (TimeoutException) { broker.Kill(); await broker.WaitForExitAsync(); }
            }
            if (peer != null && !peer.HasExited)
            {
                using var wait = new CancellationTokenSource(TimeSpan.FromSeconds(7));
                try { await peer.WaitForExit(wait.Token); }
                catch (OperationCanceledException) { error ??= "peer-exit-unverified"; failureStage ??= "cleanup"; }
            }
            if (beforeQueried && witness != null)
            {
                try { after = await witness.Query("after", CancellationToken.None); }
                catch (Exception) { error ??= "final-query-unverified"; failureStage ??= "cleanup"; }
            }
            if (witness != null) await witness.Finish();
            power?.Dispose();
        }
        try
        {
            var result = new SuspendResult(live, false, ready, stopRequested, identity, peer?.ExitCode,
                broker?.HasExited == true, broker?.HasExited == true ? broker.ExitCode : null,
                witness?.Authenticated == true, witness?.RestrictedAcl == true, witness?.ExitCode,
                preflight, before, after, cleanup, power?.Snapshot(), error, failureStage);
            return result with { Passed = Accepts(result) };
        }
        finally { peer?.Dispose(); broker?.Dispose(); witness?.Dispose(); }
    }
}
