using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FilePerformanceTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("duration totals include failures and preserve a detached snapshot", () =>
        {
            var duration = new FileDuration();
            duration.Record(20); duration.Record(7, true); duration.Record(0);
            var before = JsonSerializer.SerializeToElement(duration.Snapshot());
            duration.Record(100);
            Check(before.GetProperty("calls").GetString() == "3");
            Check(before.GetProperty("totalTicks").GetString() == "27");
            Check(before.GetProperty("maxTicks").GetString() == "20");
            Check(before.GetProperty("failed").GetString() == "1");
            bool rejected = false;
            try { duration.Record(-1); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected);
        });
        test("output timing covers header body flush but excludes record preparation and control", () =>
        {
            long clock = 0;
            var performance = new FilePerformance(() => clock, 1000);
            using var stream = new TimedStream(() => clock += 3);
            var wire = new FileWire("launch", "session", performance);
            var map = new FileMapping(new FileScope(@"C:\fixture", false), 1000);
            map.Accept(new(1, 12, 1, 1, 71, 72, 72, null, 1, 0, @"C:\fixture\a"));
            var record = map.Accept(new(2, 15, 1, 2, 71, 72, 72, null, 1, 0, null));
            int taken = 0;
            long start = clock;
            Check(wire.WriteObservations(stream, () => { clock += 20; return taken++ == 0 ? record : null; }, default).GetAwaiter().GetResult());
            performance.Pump.Record(clock - start);
            Check(!wire.WriteObservations(stream, () => null, default).GetAwaiter().GetResult());
            wire.Write(stream, "heartbeat", new { }, default).GetAwaiter().GetResult();
            var sample = JsonSerializer.SerializeToElement(performance.Snapshot(EmptyQueues()));
            Check(sample.GetProperty("frequency").GetString() == "1000");
            Check(sample.GetProperty("asOfQpc").GetString() == "58");
            Check(sample.GetProperty("pump").GetProperty("totalTicks").GetString() == "49");
            var write = sample.GetProperty("outputWrite");
            Check(write.GetProperty("calls").GetString() == "1");
            Check(write.GetProperty("totalTicks").GetString() == "9");
            Check(write.GetProperty("failed").GetString() == "0");
        });
        test("failed output writes are measured without retaining exception details", () =>
        {
            long clock = 0;
            var performance = new FilePerformance(() => clock, 1000);
            using var stream = new TimedStream(() => { clock += 5; throw new IOException("private-details"); });
            bool failed = false;
            try { new FileWire("launch", "session", performance).Write(stream, "observations", new { records = Array.Empty<object>() }, default).GetAwaiter().GetResult(); }
            catch (IOException) { failed = true; }
            string json = JsonSerializer.Serialize(performance.OutputWrite.Snapshot());
            var write = JsonSerializer.Deserialize<JsonElement>(json);
            Check(failed && write.GetProperty("calls").GetString() == "1");
            Check(write.GetProperty("totalTicks").GetString() == "5");
            Check(write.GetProperty("failed").GetString() == "1" && !json.Contains("private-details"));
        });
        test("queue stage high water remains after drain", () =>
        {
            var ingress = new FileIngress();
            ingress.Enqueue(new(1, 12, 1, 1, 71, 72, 72, null, 1, 0, @"C:\fixture\a"));
            ingress.Enqueue(new(2, 15, 1, 2, 71, 72, 72, null, 1, 0, null));
            using var pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), false);
            pipeline.Complete(); pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
            var before = pipeline.QueueSnapshot();
            Check(before.ingress.records == 0 && before.ingress.highWaterRecords == 2);
            Check(before.output.records == 1 && before.output.highWaterRecords == 1);
            Check(pipeline.Take() != null && pipeline.Take() == null);
            var after = pipeline.QueueSnapshot();
            Check(after.output.records == 0 && after.output.bytes == 0);
            Check(after.output.highWaterBytes == before.output.highWaterBytes);
            Check(after.combined.highWaterRecords == 2);
        });
    }
    private static FileQueueSnapshot EmptyQueues()
    {
        var empty = new FileQueueDepth(0, 0, 0, 0);
        return new(empty, empty, empty);
    }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("performance-check-failed"); }
    private sealed class TimedStream(Action advance) : MemoryStream
    {
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default)
        {
            advance(); return base.WriteAsync(buffer, token);
        }
        public override Task FlushAsync(CancellationToken token)
        {
            advance(); return base.FlushAsync(token);
        }
    }
}
