using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record BrokerDeathResult(bool Live, bool Passed, bool BrokerKilled, bool BrokerExited,
    bool PeerIdentityVerified, int? PeerExitCode, bool WitnessAuthenticated, bool RestrictedAcl,
    int? WitnessExitCode, TraceStats? Before, TraceStats? After, string? Error, string? FailureStage = null);

internal static class BrokerDeath
{
    private static bool Present(TraceStats? stats) => stats is
    {
        QueryStatus: 0, NumberOfBuffers: > 0, BufferSizeKiB: > 0,
        EventsLost: not null, RealTimeBuffersLost: not null, LogBuffersLost: not null, AbsentStatus: null
    };

    internal static bool Accepts(BrokerDeathResult result) => result.BrokerKilled && result.BrokerExited &&
        result.PeerIdentityVerified && result.PeerExitCode == 0 && result.WitnessAuthenticated &&
        result.RestrictedAcl && result.WitnessExitCode == 0 && result.Error == null && result.FailureStage == null &&
        (result.Live
            ? Present(result.Before) &&
              result.After is
              {
                  QueryStatus: 4201, EventsLost: null, RealTimeBuffersLost: null,
                  LogBuffersLost: null, NumberOfBuffers: null, BufferSizeKiB: null, AbsentStatus: null
              }
            : result.Before == null && result.After == null);

    internal static async Task<BrokerDeathResult> Run(bool live, CancellationToken cancellation = default)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(live ? 150 : 35));
        Witness? witness = null; Process? broker = null; ObservedProcess? peer = null;
        bool killed = false, identityVerified = false;
        TraceStats? before = null, after = null;
        string? error = null, failureStage = null;
        string stage = "witness-launch";
        try
        {
            // Arm the independent observer before the broker/collector UAC launch.
            witness = await Witness.Start(live, deadline.Token);
            deadline.Token.ThrowIfCancellationRequested();
            stage = "broker-ready";
            broker = Process.Start(Program.Child("broker", live ? "live" : "check", "broker-kill"))
                ?? throw new InvalidOperationException();
            using var ready = JsonDocument.Parse(await Scenarios.Line(broker.StandardOutput, deadline.Token));
            if (!ready.RootElement.TryGetProperty("kind", out var kind) || kind.GetString() != "ready")
                throw new InvalidDataException();
            stage = "collector-identity";
            peer = new ObservedProcess(ready.RootElement.GetProperty("peerPid").GetInt32());
            var actual = peer.Identity; var self = Security.Current();
            identityVerified = actual.Birth.ToString(CultureInfo.InvariantCulture) == ready.RootElement.GetProperty("peerBirth").GetString() &&
                actual.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase) &&
                actual.User == self.User && actual.Logon == self.Logon && actual.Elevated == live;
            if (!identityVerified) throw new UnauthorizedAccessException();
            stage = "query-before";
            before = await witness.Query("before", deadline.Token);
            if (live && !Present(before))
                throw new InvalidDataException();
            if (peer.HasExited || broker.HasExited) throw new InvalidDataException();
            stage = "broker-kill";
            // Only the held normal-token broker is terminated. Never its process tree.
            broker.Kill(); killed = true;
            await broker.WaitForExitAsync(deadline.Token);
            stage = "collector-exit";
            await peer.WaitForExit(deadline.Token);
            stage = "query-after";
            after = await witness.Query("after", deadline.Token);
        }
        catch (Exception failure)
        {
            error = cancellation.IsCancellationRequested ? "cancelled" : Program.ErrorCode(failure);
            failureStage = stage;
        }
        finally
        {
            // Before the deliberate kill, EOF still lets the collector perform normal cleanup.
            if (broker != null && !broker.HasExited)
            {
                broker.StandardInput.Close();
                try { await broker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7)); }
                catch (TimeoutException) { broker.Kill(); await broker.WaitForExitAsync(); }
            }
            if (peer != null && !peer.HasExited)
            {
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(7));
                try { await peer.WaitForExit(cleanup.Token); }
                catch (OperationCanceledException) { error ??= "peer-exit-unverified"; failureStage ??= "cleanup"; }
            }
            if (witness != null) await witness.Finish();
        }
        try
        {
            var result = new BrokerDeathResult(live, false, killed, broker?.HasExited == true, identityVerified,
                peer?.ExitCode, witness?.Authenticated == true,
                witness?.RestrictedAcl == true, witness?.ExitCode, before, after, error, failureStage);
            return result with { Passed = Accepts(result) };
        }
        finally { peer?.Dispose(); broker?.Dispose(); witness?.Dispose(); }
    }
}
