using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileCollector
{
    internal static async Task<int> Run(string[] args)
    {
        bool live = args[0] == "collector";
        if (Security.Current().Elevated != live || !FileWire.Id(args[1]) || !FileWire.Id(args[2]) || args[7] != FileWire.Profile) return 3;
        using var parent = Process.GetProcessById(int.Parse(args[4]));
        using var pipe = Security.Client(args[3]);
        Security.Verify(pipe, parent, ulong.Parse(args[5]), false, false);
        var scope = new FileScope(args[6]);
        var ingress = new FileIngress();
        bool checkLoss = args[0] == "check-loss-collector";
        if (checkLoss) FileLossFixture.OverflowIngress(ingress);
        using var pipeline = new FilePipeline(ingress, scope, live);
        var performance = new FilePerformance();
        var send = new FileWire(args[1], args[2], performance);
        var read = new FileWire(args[1], args[2]);
        using var lifetime = new CancellationTokenSource();
        using var trace = live ? new FileTrace() : null;
        using var capture = live ? new FileCapture(ingress) : null;
        FileStats stats = new(50, null, null, null, null, null);
        bool owns = false, stopped = false, drained = false;
        string? stopRequest = null;
        long lastSample = 0, statsAsOf = Stopwatch.GetTimestamp();
        uint? previousEvents = 0, previousReal = 0, previousLog = 0;
        Task? controls = null;
        var parentGone = Task.Run(async () =>
        {
            try { await parent.WaitForExitAsync(lifetime.Token); lifetime.Cancel(); }
            catch (OperationCanceledException) { }
        });
        try
        {
            await send.Write(pipe, "hello", new
            {
                build = live ? "etw-file-diagnostic-dev-4-wakeup" : "etw-file-synthetic-check-4-wakeup",
                profile = FileWire.Profile,
                schemas = FileWire.Schemas
            }, lifetime.Token);
            using var authorize = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            authorize.CancelAfter(TimeSpan.FromSeconds(10));
            var start = await read.Read(pipe, true, authorize.Token);
            if (start.t != "start") throw new InvalidDataException();
            if (trace != null)
            {
                stats = trace.Start(); owns = true;
                if (stats.Status != 0 || stats.Buffers == null || stats.Size == null) throw new InvalidOperationException();
                capture!.Start(); trace.Enable(); stats = trace.Query();
                if (stats.Status != 0) throw new InvalidOperationException();
                CheckStats();
            }
            else if (checkLoss) FileLossFixture.OverflowOutput(ingress, pipeline, scope);
            else
            {
                // Check mode never calls ETW or observes other processes; null native counters.
                long qpc = Stopwatch.GetTimestamp();
                ingress.Enqueue(new(0, 12, 1, qpc, 71, 72, null, null, 1, 0, scope.Root + "\\fixture.dat"));
                ingress.Enqueue(new(0, 15, 1, qpc + 1, 71, 72, 72, null, 1, 0, null));
            }
            long before = Stopwatch.GetTimestamp();
            lastSample = before;
            string unix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
            long after = Stopwatch.GetTimestamp();
            await send.Write(pipe, "ready", new
            {
                requestId = start.data.GetProperty("requestId").GetString(),
                frequency = Stopwatch.Frequency.ToString(),
                clock = new { qpc = before.ToString(), unixMs = unix, uncertaintyQpc = (after - before + (Stopwatch.Frequency + 999) / 1000).ToString() },
                buffers = new { count = stats.Buffers ?? 256, sizeKiB = stats.Size ?? 64 },
                telemetry = Telemetry()
            }, lifetime.Token);
            var stopSignal = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            controls = Task.Run(async () =>
            {
                try
                {
                    while (true)
                    {
                        using var lease = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                        lease.CancelAfter(TimeSpan.FromSeconds(10));
                        var command = await read.Read(pipe, true, lease.Token);
                        if (command.t == "stop") { stopSignal.TrySetResult(command.data.GetProperty("requestId").GetString()!); return; }
                        if (command.t != "ping") throw new InvalidDataException();
                    }
                }
                catch { lifetime.Cancel(); }
            });
            while (!stopSignal.Task.IsCompleted)
            {
                lifetime.Token.ThrowIfCancellationRequested();
                if (capture?.Consumer?.IsCompleted == true) throw new IOException();
                if (pipeline.Worker.IsCompleted) throw new IOException();
                if (Stopwatch.GetTimestamp() - lastSample >= 2 * Stopwatch.Frequency)
                {
                    Sample();
                    await send.Write(pipe, "heartbeat", Telemetry(), lifetime.Token);
                }
                if (!await Pump(lifetime.Token)) await Idle(lifetime.Token, stopSignal.Task, capture?.Consumer);
            }
            stopRequest = await stopSignal.Task;
            if (trace != null) { stats = trace.Stop(); stopped = stats.Status == 0; owns = !stopped; CheckStats(); }
            else stopped = true;
            using var drain = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            if (capture?.Consumer != null) await capture.Consumer.WaitAsync(drain.Token);
            pipeline.Complete();
            while (!pipeline.Worker.IsCompleted)
            {
                if (!await Pump(drain.Token)) await Idle(drain.Token);
            }
            await pipeline.Worker;
            while (await Pump(drain.Token)) { }
            drained = true;
            await send.Write(pipe, "stopped", new
            {
                requestId = stopRequest,
                drained,
                stopped,
                finalEventSeq = ingress.Totals().Delivered.ToString(),
                telemetry = Telemetry()
            }, lifetime.Token);
            return stopped ? 0 : 2;
        }
        finally
        {
            // All failure paths stop our handle BEFORE waiting for pipe tasks.
            if (owns) { stats = trace!.Stop(); stopped = stats.Status == 0; }
            lifetime.Cancel();
            pipeline.Cancel();
            pipe.Dispose();
            if (controls != null) { try { await controls; } catch { } }
            await parentGone;
            try { await pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(5)); } catch { }
            if (capture?.Consumer != null) { try { await capture.Consumer.WaitAsync(TimeSpan.FromSeconds(5)); } catch { } }
        }

        void Sample()
        {
            lastSample = Stopwatch.GetTimestamp();
            if (trace != null) stats = trace.Query();
            CheckStats();
        }
        void CheckStats()
        {
            statsAsOf = Stopwatch.GetTimestamp();
            if (stats.Status != 0 || stats.Events != previousEvents || stats.RealTime != previousReal || stats.Log != previousLog)
                pipeline.Invalidate(statsAsOf);
            previousEvents = stats.Events; previousReal = stats.RealTime; previousLog = stats.Log;
        }
        object Telemetry()
        {
            var queues = pipeline.QueueSnapshot();
            return new
            {
                operational = true,
                reasons = new[] { "mapping-uncertain", "identity-uncertain" },
                counters = new
                {
                    eventsLost = stats.Events?.ToString(),
                    realTimeBuffersLost = stats.RealTime?.ToString(),
                    logBuffersLost = stats.Log?.ToString(),
                    queryStatus = stats.Status,
                    asOfQpc = statsAsOf.ToString()
                },
                totals = pipeline.Totals(),
                queues = queues.combined,
                performance = performance.Snapshot(queues),
                coverage = FileWire.Profile
            };
        }
        async Task<bool> Pump(CancellationToken token)
        {
            long start = performance.Now(); bool success = false;
            try { bool result = await send.WriteObservations(pipe, pipeline.Take, token); success = true; return result; }
            finally { performance.Pump.Record(performance.Now() - start, !success); }
        }
        async Task Idle(CancellationToken token, Task? stop = null, Task? consumer = null)
        {
            long start = performance.Now(); bool success = false;
            // During capture the next heartbeat is the only timer. During drain,
            // mapper completion/output/cancellation suffice; completed stop and
            // capture tasks must not keep waking an empty draining queue.
            var timeout = stop == null ? Timeout.InfiniteTimeSpan : TimeSpan.FromSeconds(
                Math.Max(0, 2 - (Stopwatch.GetTimestamp() - lastSample) / (double)Stopwatch.Frequency));
            try
            {
                await FilePumpWait.WaitAsync(pipeline.OutputAvailable, pipeline.Worker, consumer, stop, timeout, token);
                success = true;
            }
            finally { performance.IdleWait.Record(performance.Now() - start, !success); }
        }
    }
}
