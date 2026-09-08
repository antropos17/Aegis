using System.Diagnostics;
using System.Text.Json;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Session;

namespace Aegis.EtwProbe;

internal static class Capture
{
    private static async Task<Process> StartActor(string root, string role, string scenario, int seconds)
    {
        var process = Process.Start(Program.Child("actor", root, role, scenario, seconds.ToString()))
            ?? throw new InvalidOperationException("Actor did not start");
        try
        {
            string? ready = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
            using var document = JsonDocument.Parse(ready ?? "null");
            if (!document.RootElement.GetProperty("ready").GetBoolean() ||
                document.RootElement.GetProperty("pid").GetInt32() != process.Id)
                throw new InvalidOperationException("Actor handshake mismatch");
            return process;
        }
        catch { End(process); throw; }
    }

    private static void End(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        finally { process.Dispose(); }
    }

    private static async Task Done(Process actor, CancellationToken token = default)
    {
        string? line = await actor.StandardOutput.ReadLineAsync(token);
        using var document = JsonDocument.Parse(line ?? "null");
        if (!document.RootElement.GetProperty("done").GetBoolean())
            throw new InvalidOperationException("Actor completion mismatch");
    }

    private static async Task Save(Process actor)
    {
        await actor.StandardInput.WriteLineAsync("save");
        await actor.StandardInput.FlushAsync();
        await actor.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
    }

    internal static async Task<int> Run(string directory, Options options, CancellationToken studyCancellation = default)
    {
        Program.Preflight(directory);
        Native.CheckLayout();
        string root = Path.Combine(directory, "aegis-etw-fixture-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var actors = new List<Process>();
        string sessionName = "AEGIS-FileProbe-" + Guid.NewGuid().ToString("N");
        TraceEventSession? session = null;
        ResourceSampler? resources = null;
        Task? consumer = null;
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(studyCancellation);
        ConsoleCancelEventHandler cancelHandler = (_, e) => { e.Cancel = true; cancel.Cancel(); };
        Console.CancelKeyPress += cancelHandler;
        try
        {
            actors.Add(await StartActor(root, "target", options.Scenario, options.Seconds));
            actors.Add(await StartActor(root, "control", options.Scenario, options.Seconds));
            var observation = new Observation(root, Native.DevicePath(root), actors.Select(p => p.Id).ToHashSet(), options.Evict);
            Program.Write(directory, "run.json", new
            {
                schema = 1,
                sessionName,
                options,
                actorPids = new { target = actors[0].Id, control = actors[1].Id },
                fixtureRoot = Path.GetFileName(root)
            });
            session = new TraceEventSession(sessionName, TraceEventSessionOptions.Create | TraceEventSessionOptions.NoRestartOnCreate)
            { StopOnDispose = true, BufferSizeMB = options.BuffersMb };
            var source = session.Source;
            source.Dynamic.All += observation.Decode;
            source.AllEvents += data =>
            {
                if (data.ProviderGuid == Program.Provider)
                    observation.Delivered[(int)data.ID] = observation.Delivered.GetValueOrDefault((int)data.ID) + 1;
            };
            source.UnhandledEvents += data => { if (data.ProviderGuid == Program.Provider) observation.Unhandled++; };
            session.EnableProvider(Program.Provider, TraceEventLevel.Verbose, options.Keywords, new TraceEventProviderOptions
            { ProcessIDFilter = options.PidFilter ? [actors[0].Id] : null, EventIDsToEnable = options.Events });
            var process = Process.GetCurrentProcess();
            TimeSpan cpuStart = process.TotalProcessorTime;
            var watch = Stopwatch.StartNew();
            consumer = Task.Run(() => source.Process());
            resources = new ResourceSampler(sessionName);
            Program.Write(directory, "capture-ready.json", new { qpc = Stopwatch.GetTimestamp() });
            foreach (var actor in actors) { await actor.StandardInput.WriteLineAsync("go"); await actor.StandardInput.FlushAsync(); }
            await Task.WhenAll(actors.Select(p => Done(p, cancel.Token))).WaitAsync(TimeSpan.FromSeconds(options.Seconds + 20), cancel.Token);
            await Task.Delay(1000, cancel.Token); // Drain tail events before querying loss/stopping.
            await resources.Stop();
            var loss = Native.QueryLoss(sessionName);
            session.Stop();
            await consumer.WaitAsync(TimeSpan.FromSeconds(10));
            process.Refresh();
            double durationMs = watch.Elapsed.TotalMilliseconds;
            double collectorCpuMs = (process.TotalProcessorTime - cpuStart).TotalMilliseconds;
            long collectorPeakWorkingSetBytes = process.PeakWorkingSet64;
            Program.Write(directory, "capture-stopped.json", new { qpc = Stopwatch.GetTimestamp() });
            await Task.WhenAll(actors.Select(Save));
            Program.Write(directory, "events.json", observation.Samples);
            Program.Write(directory, "schemas.json", observation.Schemas);
            Program.Write(directory, "resources.json", resources.Samples);
            bool actorsOk = actors.All(p => p.ExitCode == 0);
            Program.Write(directory, "summary.json", new
            {
                schema = 1,
                collectionCompleted = true,
                actorsOk,
                durationMs,
                collectorCpuMs,
                collectorPeakWorkingSetBytes,
                resourceSamplingDegraded = resources.Degraded,
                omittedResourceSamples = resources.Omitted,
                loss,
                observation.Delivered,
                observation.Unhandled,
                observation.DecodeErrors,
                observation.DecodedReads,
                observation.FixturePathReads,
                observation.UnresolvedActorReads,
                observation.PathConflicts,
                observation.OmittedSamples,
                observation.MappingResets,
                observation.AliasOverflows,
                interpretation = "Candidate correlations only; operation ledger does not prove per-operation ETW emission. " +
                    "Loss query precedes stop; unavailable counters are null. Collector CPU excludes provider-wide kernel cost."
            });
            // Nonzero on degraded observations; retain artifacts for diagnosing the loss.
            return actorsOk && !resources.Degraded && loss.QueryStatus == 0 && loss.EventsLost == 0 && loss.RealTimeBuffersLost == 0 &&
                loss.LogBuffersLost == 0 && observation.Unhandled == 0 && observation.PathConflicts == 0 &&
                observation.DecodeErrors == 0 && observation.OmittedSamples == 0 && observation.MappingResets == 0 && observation.AliasOverflows == 0 ? 0 : 5;
        }
        catch (Exception error)
        {
            Program.Write(directory, "failure.json", new
            {
                collectionCompleted = false,
                sessionName,
                errorType = error.GetType().Name,
                hresult = error.HResult
            });
            throw;
        }
        finally
        {
            try
            {
                try { if (resources != null) await resources.DisposeAsync(); }
                finally { session?.Dispose(); } // Only the GUID-named session this run created.
            }
            finally
            {
                if (consumer != null) { try { await consumer.WaitAsync(TimeSpan.FromSeconds(10)); } catch { /* failure.json/exit code report it */ } }
                foreach (var actor in actors) { try { End(actor); } catch { /* Continue cleanup of the other owned child. */ } }
                Console.CancelKeyPress -= cancelHandler;
            }
        }
    }

    internal static async Task<int> CheckFixtures(string directory)
    {
        foreach (var scenario in Fixture.Scenarios)
        {
            string root = Path.Combine(directory, "aegis-etw-fixture-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            var actor = await StartActor(root, "target", scenario, 1);
            try
            {
                await actor.StandardInput.WriteLineAsync("go");
                await actor.StandardInput.FlushAsync();
                await Done(actor).WaitAsync(TimeSpan.FromSeconds(15));
                if (File.Exists(Path.Combine(root, "target-operations.json")))
                    throw new InvalidOperationException("Ledger written before permission");
                await Save(actor);
                if (actor.ExitCode != 0) throw new InvalidOperationException("Fixture failed");
                using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "target-operations.json")));
                int count = json.RootElement.GetProperty("operations").GetInt32();
                if ((scenario == "idle" && count != 0) || (scenario != "idle" && count <= 0))
                    throw new InvalidOperationException("Fixture count mismatch");
                Console.WriteLine($"{scenario}: {count} completed operations");
            }
            finally { End(actor); }
        }
        return 0;
    }
}
