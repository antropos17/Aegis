using System.Diagnostics;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileForwardingTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("fragmented broker input forwards consecutive observation bytes without rewriting", () =>
        {
            var record = Observation() with
            {
                generationStatus = "candidate",
                generationSource = "createTime100ns",
                generationWitness = "9007199254740993",
                generationInterval = new { fromQpc = "5", toQpc = "6" }
            };
            var unicode = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
            string first = Json("observations", "1", "{ \"records\" : [" + JsonSerializer.Serialize(record) + "] }");
            string second = Json("observations", "2", "{\"records\":[" + JsonSerializer.Serialize(record with { eventSeq = "3" }, unicode) + "]}");
            byte[] bytes = [.. Frame(first), .. Frame(second)];
            using var input = new FragmentedStream(bytes);
            using var output = new MemoryStream();
            var reader = new FileWire("launch", "session");
            var profile = new FileForwardProfile();
            for (int i = 1; i <= 2; i++)
            {
                var received = reader.ReadFrame(input, false, default).GetAwaiter().GetResult();
                Check(received.Message.seq == i.ToString(), "frame-order");
                profile.Forward(output, received, default).GetAwaiter().GetResult();
            }
            Check(output.ToArray().SequenceEqual(bytes), "observation-reencoded");
        });
        test("maximum-size validated body stays bounded through forwarding", () =>
        {
            string json = Json("observations", "1", "{\"records\":[]}");
            byte[] bytes = Frame(json.PadRight(FileWire.Limit));
            using var input = new MemoryStream(bytes);
            using var output = new MemoryStream();
            var received = new FileWire("launch", "session").ReadFrame(input, false, default).GetAwaiter().GetResult();
            new FileForwardProfile().Forward(output, received, default).GetAwaiter().GetResult();
            Check(output.Length == FileWire.Limit + 4 && output.ToArray().SequenceEqual(bytes), "frame-limit");
        });
        test("invalid broker input cannot reach the forwarding stream", () =>
        {
            string valid = Json("observations", "1", "{\"records\":[]}");
            var invalid = new List<byte[]>
            {
                Frame(valid.Replace("\"launch\"", "\"foreign\"")),
                Frame(valid.Replace("\"session\"", "\"foreign\"")),
                Frame(valid.Replace(FileWire.Protocol, "etw-file/4")),
                Frame(Json("observations", "01", "{}")),
                Frame(Json("unknown", "1", "{}")),
                Frame(Json("start", "1", "{}")),
                Frame(valid.Replace("\"seq\" : \"1\"", "\"seq\":\"1\",\"seq\":\"2\"")),
                Frame(Json("observations", "1", new string('[', 20) + "0" + new string(']', 20))),
                Frame("{"), Frame(valid)[..^1], Frame(""),
                new byte[] { 1, 0, 0, 0, 255 }, // Invalid UTF-8.
            };
            var oversized = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(oversized, FileWire.Limit + 1);
            invalid.Add(oversized);
            foreach (var bytes in invalid)
            {
                using var input = new MemoryStream(bytes);
                using var output = new MemoryStream();
                bool rejected = false;
                try
                {
                    var received = new FileWire("launch", "session").ReadFrame(input, false, default).GetAwaiter().GetResult();
                    new FileForwardProfile().Forward(output, received, default).GetAwaiter().GetResult();
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException or EndOfStreamException or DecoderFallbackException)
                { rejected = true; }
                Check(rejected && output.Length == 0, "unvalidated-frame-forwarded");
            }
        });
        test("replayed input is rejected before a second forward", () =>
        {
            byte[] bytes = Frame(Json("observations", "1", "{\"records\":[]}"));
            using var input = new MemoryStream([.. bytes, .. bytes]);
            using var output = new MemoryStream();
            var reader = new FileWire("launch", "session");
            var profile = new FileForwardProfile();
            profile.Forward(output, reader.ReadFrame(input, false, default).GetAwaiter().GetResult(), default).GetAwaiter().GetResult();
            bool rejected = false;
            try { profile.Forward(output, reader.ReadFrame(input, false, default).GetAwaiter().GetResult(), default).GetAwaiter().GetResult(); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected && output.ToArray().SequenceEqual(bytes), "replay-forwarded");
        });
        test("every telemetry kind is annotated instead of forwarding the stale body", () =>
        {
            foreach (string kind in new[] { "ready", "health", "heartbeat", "stopped" })
            {
                const string sample = "{\"performance\":{\"brokerForward\":null}}";
                string data = kind is "ready" or "stopped" ? "{\"telemetry\":" + sample + "}" : sample;
                using var input = new MemoryStream(Frame(Json(kind, "1", data)));
                using var output = new MemoryStream();
                var received = new FileWire("launch", "session").ReadFrame(input, false, default).GetAwaiter().GetResult();
                new FileForwardProfile(() => 123).Forward(output, received, default).GetAwaiter().GetResult();
                output.Position = 0;
                var frame = new FileWire("launch", "session").Read(output, false, default).GetAwaiter().GetResult();
                Check(frame.t == kind && frame.seq == received.Message.seq, "telemetry-identity");
                var telemetry = kind is "ready" or "stopped" ? frame.data.GetProperty("telemetry") : frame.data;
                var original = kind is "ready" or "stopped" ? received.Message.data.GetProperty("telemetry") : received.Message.data;
                Check(telemetry.GetProperty("performance").GetProperty("brokerForward").GetProperty("asOfQpc").GetString() == "123", "stale-telemetry");
                Check(original.GetProperty("performance").GetProperty("brokerForward").ValueKind == JsonValueKind.Null, "input-mutated");
            }
        });
        test("cancelled forwarding emits no body and does not poison a later forward", () =>
        {
            byte[] bytes = Frame(Json("observations", "1", "{\"records\":[]}"));
            using var input = new MemoryStream(bytes);
            using var output = new MemoryStream();
            using var cancel = new CancellationTokenSource(); cancel.Cancel();
            var received = new FileWire("launch", "session").ReadFrame(input, false, default).GetAwaiter().GetResult();
            var profile = new FileForwardProfile();
            bool rejected = false;
            try { profile.Forward(output, received, cancel.Token).GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { rejected = true; }
            Check(rejected && output.Length == 0, "cancelled-output");
            profile.Forward(output, received, default).GetAwaiter().GetResult();
            Check(output.ToArray().SequenceEqual(bytes), "forward-poisoned");
        });
        test("broker forwarding allocates less than re-encoding validated observation frames", () =>
        {
            var record = Observation();
            using var source = new MemoryStream();
            var writer = new FileWire("launch", "session");
            for (int i = 0; i < 100; i++)
                writer.Write(source, "observations", new { records = Enumerable.Range(0, 64).Select(n => record with { eventSeq = (i * 64 + n + 1).ToString() }).ToArray() }, default).GetAwaiter().GetResult();
            var input = source.ToArray();
            (long Bytes, long Ticks) Measure(bool previous)
            {
                using var incoming = new MemoryStream(input);
                using var outgoing = new MemoryStream(FileWire.Limit);
                var read = new FileWire("launch", "session");
                var profile = new FileForwardProfile();
                long bytes = GC.GetAllocatedBytesForCurrentThread(), start = Stopwatch.GetTimestamp();
                for (int i = 0; i < 100; i++)
                {
                    outgoing.SetLength(0); outgoing.Position = 0;
                    var frame = read.ReadFrame(incoming, false, default).GetAwaiter().GetResult();
                    if (previous) FileWire.Forward(outgoing, frame.Message, default).GetAwaiter().GetResult();
                    else profile.Forward(outgoing, frame, default).GetAwaiter().GetResult();
                }
                return (GC.GetAllocatedBytesForCurrentThread() - bytes, Stopwatch.GetTimestamp() - start);
            }
            Measure(true); Measure(false);
            var before = new List<(long Bytes, long Ticks)>();
            var after = new List<(long Bytes, long Ticks)>();
            for (int i = 0; i < 5; i++)
            {
                // Alternate order to reduce warm-up and drift bias in the timing report.
                if (i % 2 == 0) { before.Add(Measure(true)); after.Add(Measure(false)); }
                else { after.Add(Measure(false)); before.Add(Measure(true)); }
            }
            before.Sort((a, b) => a.Ticks.CompareTo(b.Ticks)); after.Sort((a, b) => a.Ticks.CompareTo(b.Ticks));
            Console.WriteLine($"BROKER_FORWARD frames=100 records=6400 previousBytes={before[2].Bytes} currentBytes={after[2].Bytes} previousMedianTicks={before[2].Ticks} currentMedianTicks={after[2].Ticks} frequency={Stopwatch.Frequency}");
            // Allocation is deterministic; wall time is reported, never a flaky CI gate.
            Check(after[2].Bytes < before[2].Bytes * 0.95, "broker-allocation-regression");
        });
    }
    private static FileObservation Observation()
    {
        var map = new FileMapping(new FileScope(@"C:\fixture", false), Stopwatch.Frequency);
        map.Accept(new(1, 12, 1, 1, 71, 72, 72, null, 1, 0, @"C:\fixture\тест&"));
        return map.Accept(new(2, 15, 1, 2, 71, 72, 72, null, 1, 0, null))!;
    }
    private static string Json(string kind, string seq, string data) =>
        $"{{ \"t\" : \"{kind}\", \"proto\" : \"{FileWire.Protocol}\", \"launchId\" : \"launch\", \"sessionId\" : \"session\", \"seq\" : \"{seq}\", \"data\" : {data} }}";
    private static byte[] Frame(string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json), result = new byte[body.Length + 4];
        BinaryPrimitives.WriteInt32LittleEndian(result, body.Length); body.CopyTo(result, 4);
        return result;
    }
    private sealed class FragmentedStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default) =>
            base.ReadAsync(buffer[..Math.Min(7, buffer.Length)], token);
    }
    private static void Check(bool value, string reason)
    { if (!value) throw new InvalidOperationException(reason); }
}
