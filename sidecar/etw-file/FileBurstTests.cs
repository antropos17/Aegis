using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileBurstTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("blocked process witness does not stall lifecycle ingress", () =>
        {
            using var entered = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            var ingress = new FileIngress();
            using var pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), true, value =>
            {
                entered.Set();
                if (!release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("probe-release");
                return value;
            });
            long qpc = Stopwatch.GetTimestamp();
            Feed(ingress, 12, ++qpc, @"C:\fixture\a");
            Feed(ingress, 15, ++qpc);
            var reader = Task.Run(() =>
            {
                FileObservation? record = null;
                Check(SpinWait.SpinUntil(() => (record = pipeline.Take()) != null, 5000), "reader");
                return record;
            });
            try
            {
                Check(entered.Wait(TimeSpan.FromSeconds(3)), "probe-entry");
                for (int batch = 0; batch < 32; batch++)
                {
                    for (int i = 0; i < 256; i++) Feed(ingress, 15, ++qpc);
                    Check(SpinWait.SpinUntil(() => ingress.Snapshot().Records == 0, 2000), "ingress-stalled-on-probe");
                }
                // Lifecycle work must finish even after the bounded outbound queue fills.
                Feed(ingress, 14, ++qpc);
                pipeline.Complete();
                pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
                Check(ingress.Totals().Dropped == 0, "raw-loss");
                Check(pipeline.OutputDropped > 0, "outbound-cap-not-exercised");
                using var totals = JsonDocument.Parse(JsonSerializer.Serialize(pipeline.Totals()));
                Check(totals.RootElement.GetProperty("ingressDropped").GetString() == "0", "ingress-counter");
                Check(totals.RootElement.GetProperty("outputDropped").GetString() == pipeline.OutputDropped.ToString(), "output-counter");
                Check(ulong.Parse(totals.RootElement.GetProperty("mapResets").GetString()!) > 0, "close-not-processed");
            }
            finally
            {
                release.Set();
                pipeline.Cancel();
                pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
                reader.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
            }
        });
        test("process witnesses are fresh at delivery and keep the probe budget", () =>
        {
            var ingress = new FileIngress();
            int probes = 0;
            long time = Stopwatch.Frequency;
            using var pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), true,
                value => value with { generationWitness = (++probes).ToString() }, () => time);
            Feed(ingress, 12, 1, @"C:\fixture\a");
            for (int i = 2; i <= 4; i++) Feed(ingress, 15, i);
            Finish(pipeline);
            Check(probes == 0, "probed-before-delivery");
            var first = pipeline.Take();
            var second = pipeline.Take();
            time += Stopwatch.Frequency / 100;
            var third = pipeline.Take();
            Check(first?.generationWitness == "1", "first-witness");
            Check(second != null && second.generationWitness == null, "budget-or-cached-witness");
            Check(third?.generationWitness == "2" && probes == 2, "fresh-witness");
            Check(first is { agent: null, instanceId: null }, "attribution");
        });
        foreach (bool decoderGap in new[] { false, true })
        {
            test(decoderGap ? "decoder gap retires an in-flight witness" : "native loss retires an in-flight witness", () =>
            {
                using var entered = new ManualResetEventSlim();
                using var release = new ManualResetEventSlim();
                var ingress = new FileIngress();
                using var pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), true, value =>
                {
                    entered.Set();
                    if (!release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("probe-release");
                    return value;
                });
                Feed(ingress, 12, 1, @"C:\fixture\a");
                Feed(ingress, 15, 2);
                Check(SpinWait.SpinUntil(() => ingress.Snapshot().Records == 0, 2000), "initial-drain");
                var reader = Task.Run(() =>
                {
                    FileObservation? result = null;
                    // Wait for the record to reach output before taking it just once.
                    Check(SpinWait.SpinUntil(() => (result = pipeline.Take()) != null || entered.IsSet, 5000), "reader");
                    return result;
                });
                try
                {
                    Check(entered.Wait(TimeSpan.FromSeconds(3)), "probe-entry");
                    Feed(ingress, 15, 3);
                    if (decoderGap) ingress.DecodeError();
                    else pipeline.Invalidate(3);
                    Finish(pipeline);
                }
                finally
                {
                    release.Set();
                    pipeline.Cancel();
                    pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
                }
                Check(reader.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult() == null, "invalidated-record-escaped");
                ulong emitted = 0;
                while (pipeline.Take() != null) emitted++;
                using var total = JsonDocument.Parse(JsonSerializer.Serialize(pipeline.Totals()));
                ulong Counter(string name) => ulong.Parse(total.RootElement.GetProperty(name).GetString()!);
                Check(Counter("dropped") >= 1, "in-flight-loss-not-counted");
                Check(Counter("dropped") == Counter("ingressDropped") + Counter("outputDropped"), "stage-loss-accounting");
                Check(Counter("outputDropped") >= 1, "in-flight-stage");
                Check(Counter("delivered") == Counter("filtered") + Counter("dropped") + Counter("decoderErrors") + emitted,
                    "loss-accounting");
            });
        }
        test("large selected paths obey the retained-output byte bound", () =>
        {
            var ingress = new FileIngress();
            using var pipeline = new FilePipeline(ingress, new FileScope(@"C:\fixture", false), false);
            string path = @"C:\fixture\" + new string('x', 32700);
            Feed(ingress, 12, 1, path);
            for (int i = 2; i <= 257; i++) Feed(ingress, 15, i);
            Finish(pipeline);
            using var queues = JsonDocument.Parse(JsonSerializer.Serialize(pipeline.Queues()));
            Check(queues.RootElement.GetProperty("bytes").GetInt32() <= 4 * 1024 * 1024, "byte-cap");
            Check(queues.RootElement.GetProperty("highWaterBytes").GetInt32() <= 4 * 1024 * 1024, "high-water-cap");
            ulong output = 0;
            while (pipeline.Take() is { } record)
            {
                Check(record.path == path && record.agent == null && record.instanceId == null, "selected-evidence");
                output++;
            }
            Check(output > 0 && output < 256 && output + pipeline.OutputDropped == 256, "byte-loss-accounting");
            Check(ingress.Totals().Dropped == 0, "unexpected-raw-loss");
        });
        test("split counters cover raw overflow, buffered discard and outbound overflow", () =>
        {
            var scope = new FileScope(@"C:\fixture", false);
            var ingress = new FileIngress();
            FileLossFixture.OverflowIngress(ingress);
            using var pipeline = new FilePipeline(ingress, scope, false);
            FileLossFixture.OverflowOutput(ingress, pipeline, scope);
            Finish(pipeline);
            ulong output = 0;
            while (pipeline.Take() != null) output++;
            using var total = JsonDocument.Parse(JsonSerializer.Serialize(pipeline.Totals()));
            ulong Counter(string name) => ulong.Parse(total.RootElement.GetProperty(name).GetString()!);
            Check(Counter("ingressDropped") == 4097, "raw-overflow-and-discard");
            Check(Counter("outputDropped") == 8192 - output, "outbound-overflow");
            Check(Counter("decoderErrors") == 0 && Counter("filtered") == 1, "distinct-filtering");
            Check(Counter("dropped") == Counter("ingressDropped") + Counter("outputDropped"), "stage-sum");
            Check(Counter("delivered") == Counter("filtered") + Counter("dropped") + output, "total-accounting");
        });
    }

    private static void Finish(FilePipeline pipeline)
    {
        pipeline.Complete();
        pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
    }

    private static void Feed(FileIngress ingress, int id, long qpc, string? name = null) =>
        ingress.Enqueue(new(0, id, 1, qpc, 71, 72, 72, null, 1, 0, name));

    private static void Check(bool value, string reason)
    {
        if (!value) throw new InvalidOperationException(reason);
    }
}
