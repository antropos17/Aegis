using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileOutputProfileTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("burst windows separate enqueue drain overflow and invalidation at boundaries", () =>
        {
            var flow = new FileOutputProfile(1000);
            flow.Enqueue(1, 100); flow.Enqueue(99, 200); flow.Overflow(99);
            flow.Dequeue(100, 100); flow.Invalidate(101);
            flow.Enqueue(102, 300); flow.Dequeue(110, 300);
            var sample = JsonSerializer.SerializeToElement(flow.Snapshot(120));
            var windows = sample.GetProperty("windows");
            Check(windows.GetArrayLength() == 2);
            Check(windows[0].GetProperty("toQpc").GetString() == "100");
            Check(windows[0].GetProperty("records").GetInt32() == 2);
            Check(windows[0].GetProperty("highWaterBytes").GetInt32() == 300);
            Check(windows[0].GetProperty("overflow").GetString() == "1");
            Check(windows[1].GetProperty("startRecords").GetInt32() == 2);
            Check(windows[1].GetProperty("enqueued").GetString() == "1");
            Check(windows[1].GetProperty("dequeued").GetString() == "2");
            Check(windows[1].GetProperty("invalidated").GetString() == "1");
            Check(windows[1].GetProperty("records").GetInt32() == 0);
            var ready = sample.GetProperty("readyToTake");
            Check(ready.GetProperty("calls").GetString() == "2");
            Check(ready.GetProperty("totalTicks").GetString() == "107");
            flow.Enqueue(125, 400);
            Check(windows[1].GetProperty("records").GetInt32() == 0); // Detached snapshot.
        });
        test("invalidated readiness is not reused or counted as a successful dequeue", () =>
        {
            var flow = new FileOutputProfile(1000);
            flow.Enqueue(1, 100); flow.Invalidate(90);
            flow.Enqueue(100, 100); flow.Dequeue(107, 100);
            var ready = JsonSerializer.SerializeToElement(flow.Snapshot(120)).GetProperty("readyToTake");
            Check(ready.GetProperty("calls").GetString() == "1");
            Check(ready.GetProperty("totalTicks").GetString() == "7");
        });
        test("profile ring remains bounded and skips arbitrarily long quiet gaps", () =>
        {
            var flow = new FileOutputProfile(1000);
            for (int i = 0; i < 300; i++)
            {
                flow.Enqueue(i * 100, 100); flow.Dequeue(i * 100 + 1, 100);
            }
            var before = JsonSerializer.SerializeToElement(flow.Snapshot(29901));
            Check(before.GetProperty("windows").GetArrayLength() == 256);
            Check(before.GetProperty("evictedWindows").GetString() == "44");
            // A huge jump must not allocate an entry for each idle interval.
            var after = JsonSerializer.SerializeToElement(flow.Snapshot(1000000000000));
            Check(after.GetProperty("windows").GetArrayLength() == 256);
            Check(after.GetProperty("evictedWindows").GetString() == "45");
            Check(after.GetProperty("windows")[255].GetProperty("fromQpc").GetString() == "1000000000000");
            Check(before.GetProperty("windows")[255].GetProperty("fromQpc").GetString() == "29900");
        });
        test("broker reports completed forwards and accounts failed writes without error details", () =>
        {
            long clock = 0;
            var forward = new FileForwardProfile(() => clock);
            using var bad = new TimedStream(() => { clock += 5; throw new IOException("private-error"); });
            bool failed = false;
            try { forward.Forward(bad, Frame("observations", new { records = Array.Empty<object>() }), default).GetAwaiter().GetResult(); }
            catch (IOException) { failed = true; }
            Check(failed);
            clock += 1000000; // Time waiting for the next input is not forwarding time.
            using var good = new TimedStream(() => clock += 7);
            var payload = new { performance = new { brokerForward = (object?)null } };
            forward.Forward(good, Frame("heartbeat", payload), default).GetAwaiter().GetResult();
            good.Position = 0;
            var read = new FileWire("launch", "session").Read(good, false, default).GetAwaiter().GetResult();
            var profile = read.data.GetProperty("performance").GetProperty("brokerForward");
            Check(profile.GetProperty("asOfQpc").GetString() == "1000005");
            Check(profile.GetProperty("duration").GetProperty("calls").GetString() == "1");
            Check(profile.GetProperty("duration").GetProperty("failed").GetString() == "1");
            Check(profile.GetProperty("duration").GetProperty("totalTicks").GetString() == "5");
            good.SetLength(0); good.Position = 0;
            forward.Forward(good, Frame("stopped", new { telemetry = payload }), default).GetAwaiter().GetResult();
            good.Position = 0;
            read = new FileWire("launch", "session").Read(good, false, default).GetAwaiter().GetResult();
            profile = read.data.GetProperty("telemetry").GetProperty("performance").GetProperty("brokerForward");
            Check(profile.GetProperty("duration").GetProperty("calls").GetString() == "2");
            Check(profile.GetProperty("duration").GetProperty("totalTicks").GetString() == "26");
            Check(!read.data.GetRawText().Contains("private-error"));
        });
    }
    private static FileWire.ReceivedFrame Frame(string kind, object data)
    {
        using var stream = new MemoryStream();
        new FileWire("launch", "session").Write(stream, kind, data, default).GetAwaiter().GetResult();
        stream.Position = 0;
        return new FileWire("launch", "session").ReadFrame(stream, false, default).GetAwaiter().GetResult();
    }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("output-profile-check-failed"); }
    private sealed class TimedStream(Action advance) : MemoryStream
    {
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default)
        { advance(); return base.WriteAsync(buffer, token); }
        public override Task FlushAsync(CancellationToken token)
        { advance(); return base.FlushAsync(token); }
    }
}
