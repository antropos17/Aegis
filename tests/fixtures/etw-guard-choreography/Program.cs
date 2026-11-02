using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class Program
{
    private static Process? retainedChild;
    private static bool childMode;
    internal static bool GuardMode => childMode;
    internal static string Case => Environment.GetEnvironmentVariable("AEGIS_GUARD_FIXTURE_CASE") ?? "baseline";
    internal static bool DelayedReply => Case == "independent-service-latencies";
    private static string EventRoot => Environment.GetEnvironmentVariable("AEGIS_GUARD_FIXTURE_EVENTS") ?? throw new InvalidDataException("fixture-events-required");
    internal static void Event(string name)
    {
        if (name is not ("owner-read-started" or "owner-reserve-packet-read" or "owner-reserve-reply-started" or "owner-reserve-reply-completed")) throw new InvalidDataException();
        File.WriteAllText(Path.Combine(EventRoot, name), Environment.TickCount64.ToString());
    }
    internal static void Mark(string phase) => Console.Error.WriteLine(JsonSerializer.Serialize(new
    { role = childMode ? "guard" : "collector-broker", phase, tickMs = Environment.TickCount64, pid = Environment.ProcessId }));
    internal static void RetainChild(Process original)
    {
        if (retainedChild != null) throw new InvalidOperationException("fixture-extra-child");
        retainedChild = Process.GetProcessById(original.Id);
        _ = retainedChild.SafeHandle;
        Mark("child-retained");
    }
    internal static ProcessStartInfo Child(params string[] args)
    {
        if (args.Length != 8 || args[0] != "guard") throw new InvalidDataException("fixture-only-primary-guard");
        var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            info.ArgumentList.Add(typeof(Program).Assembly.Location);
        foreach (string value in args) info.ArgumentList.Add(value);
        Mark("child-starting");
        return info;
    }
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 8 && args[0] == "guard")
        {
            childMode = true;
            Mark("guard-entry");
            try { return await FileGuard.Run(args); }
            catch (Exception error) { Mark("guard-" + error.GetType().Name); return 2; }
        }
        string selected = args.Length == 0 ? "baseline" : args.Length == 2 && args[0] == "--case" ? args[1] : "";
        if (selected is not ("baseline" or "independent-service-latencies" or "bad-guard-ack" or "bad-broker-ack" or
            "bad-guard-ack-broker-pending" or "bad-broker-ack-guard-pending" or "guard-exit-before-reserved")) return 3;
        Environment.SetEnvironmentVariable("AEGIS_GUARD_FIXTURE_CASE", selected);
        FileQualificationDiagnostic.Step = 0;
        FileQualificationDiagnostic.BeginCollector();
        using var bound = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var watch = Stopwatch.StartNew();
        try
        {
            var result = await Baseline(bound.Token, selected);
            Console.WriteLine(JsonSerializer.Serialize(new
            { schema = "aegis-guard-choreography-fixture/1", status = "PASS", @case = selected, elapsedMs = watch.ElapsedMilliseconds,
                guardOwnerStartupBudgetMs = 8000, result.ownerReturned, result.reserveAcknowledged, result.normalDisarm,
                result.expectedRejection, result.guardAcknowledgedBeforeBroker,
                result.otherAcknowledgementPendingOnRejection,
                actualPrimaryBrokerStartup = !selected.StartsWith("bad-broker-ack", StringComparison.Ordinal), fallbackExercised = false, controlledAuthentication = true,
                nativeTraceCalls = false, elevation = false }));
            return 0;
        }
        catch (Exception error)
        {
            FileQualificationDiagnostic.Report(error);
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            { status = "FAIL", type = error.GetType().Name, error = error.Message, elapsedMs = watch.ElapsedMilliseconds }));
            return 1;
        }
        finally
        {
            if (retainedChild != null)
            {
                // Retain the original fixture-child handle before any failure;
                // cleanup never enumerates or terminates an unrelated PID.
                try
                {
                    try { if (!retainedChild.HasExited) retainedChild.Kill(); }
                    catch (InvalidOperationException) when (retainedChild.HasExited) { }
                    if (!retainedChild.WaitForExit(2000)) throw new InvalidOperationException("fixture-child-exit-unconfirmed");
                    Mark("original-fixture-child-exit-confirmed");
                }
                catch (Exception error) { Mark("fixture-cleanup-" + error.GetType().Name); throw; }
                retainedChild.Dispose();
            }
        }
    }
    private sealed record Outcome(bool ownerReturned, bool reserveAcknowledged, bool normalDisarm,
        bool expectedRejection, bool guardAcknowledgedBeforeBroker, bool otherAcknowledgementPendingOnRejection);
    private static async Task WaitEvent(string name, CancellationToken token)
    {
        while (!File.Exists(Path.Combine(EventRoot, name))) await Task.Delay(10, token);
    }
    private static async Task<Outcome> Baseline(CancellationToken token, string selected)
    {
        string dataId = Guid.NewGuid().ToString("N"), recoveryId = Guid.NewGuid().ToString("N");
        using var data = Security.Server(dataId);
        using var recovery = Security.Server(recoveryId);
        Task dataConnected = data.WaitForConnectionAsync(token);
        using var collectorData = Security.Client(dataId);
        await dataConnected;
        using var broker = Process.GetCurrentProcess();
        using var endBroker = CancellationTokenSource.CreateLinkedTokenSource(token);
        Task<FileGuardResult>? recoveryResult = null;
        async Task ConnectPrimary(int pid, ulong birth, string reservation, CancellationToken connectionToken)
        {
            await recovery.WaitForConnectionAsync(connectionToken);
            using var guard = Process.GetProcessById(pid);
            Security.Verify(recovery, guard, birth, true, true);
            recoveryResult = FileGuardWire.Read<FileGuardResult>(recovery, token);
            if (selected == "bad-guard-ack-broker-pending")
            {
                Mark("broker-ack-gated");
                await Task.Delay(Timeout.Infinite, connectionToken);
            }
            if (selected == "independent-service-latencies")
            {
                Mark("broker-ack-service-start");
                await Task.Delay(6000, connectionToken);
            }
            Mark("broker-connected-ack-ready");
        }
        async Task BadBroker()
        {
            var hello = await FileGuardWire.Read<FileGuardHello>(data, endBroker.Token);
            await ConnectPrimary(hello.pid, ulong.Parse(hello.birth), hello.guid, endBroker.Token);
            await WaitEvent(selected == "bad-broker-ack-guard-pending" ? "owner-reserve-reply-started" : "owner-reserve-reply-completed", endBroker.Token);
            await FileGuardWire.Write(data, new FileGuardCommand("unexpected"), endBroker.Token);
            await Task.Delay(Timeout.Infinite, endBroker.Token);
        }
        var brokerStartup = selected.StartsWith("bad-broker-ack", StringComparison.Ordinal) ? BadBroker() :
            FileBrokerStartup.Connect(data, broker.Id, broker.Id, ConnectPrimary,
                (_, _, _, _) => throw new InvalidOperationException("fixture-fallback-forbidden"), null, endBroker.Token);
        FileGuardOwner? owner = null;
        bool expectedRejected = false;
        try
        {
            Mark("owner-start");
            var start = FileGuardOwner.Start(recoveryId, broker, 1, collectorData,
                Guid.NewGuid().ToString("N"), "normal");
            bool beforeBroker = false;
            if (selected == "independent-service-latencies")
            {
                await WaitEvent("owner-reserve-reply-completed", token);
                beforeBroker = !start.IsCompleted;
                if (!beforeBroker) throw new InvalidDataException("fixture-owner-returned-before-broker");
                Mark("guard-reserved-while-broker-ack-pending");
            }
            try { owner = await start.WaitAsync(token); }
            catch (Exception error) when ((selected.StartsWith("bad-guard-ack", StringComparison.Ordinal) || selected.StartsWith("bad-broker-ack", StringComparison.Ordinal)) && error is InvalidDataException ||
                selected == "guard-exit-before-reserved" && error is IOException)
            {
                if (selected == "guard-exit-before-reserved" &&
                    (retainedChild == null || !retainedChild.WaitForExit(2000) || retainedChild.ExitCode != 72))
                    throw new InvalidDataException("fixture-original-peer-exit");
                Mark("expected-rejection-" + error.GetType().Name);
                bool otherPending = selected == "bad-guard-ack-broker-pending" ? !brokerStartup.IsCompleted :
                    selected == "bad-broker-ack-guard-pending" && !File.Exists(Path.Combine(EventRoot, "owner-reserve-reply-completed"));
                if (selected.EndsWith("-pending", StringComparison.Ordinal) && !otherPending)
                    throw new InvalidDataException("fixture-other-ack-not-pending");
                expectedRejected = true;
                return new(false, false, false, true, false, otherPending);
            }
            if (selected.StartsWith("bad-", StringComparison.Ordinal) || selected == "guard-exit-before-reserved")
                throw new InvalidDataException("fixture-invalid-peer-accepted");
            Mark("reserve-ack-received");
            if (!owner.Alive) throw new InvalidDataException("fixture-guard-not-alive");
            // The actual primary path finished. Do not manufacture a fallback peer.
            endBroker.Cancel();
            try { await brokerStartup; } catch (OperationCanceledException) { }
            await owner.Disarm().WaitAsync(token);
            Mark("normal-disarm-complete");
            var result = await (recoveryResult ?? throw new InvalidDataException()).WaitAsync(token);
            if (result.kind != "disarmed" || !result.absent || !result.stopped || !owner.Ended)
                throw new InvalidDataException("fixture-disarm-result");
            return new(true, true, true, false, beforeBroker, false);
        }
        finally
        {
            endBroker.Cancel();
            if (owner != null) await owner.DisposeAsync();
            try { await brokerStartup; } catch (OperationCanceledException) { }
            catch (IOException) when (expectedRejected) { Mark("broker-failed-peer-closure-observed"); }
            catch (Exception error) when (expectedRejected && selected == "guard-exit-before-reserved" && retainedChild?.HasExited == true)
            { Mark("broker-original-peer-exit-" + error.GetType().Name); }
        }
    }
}
