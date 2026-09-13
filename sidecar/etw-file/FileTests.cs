using System.Buffers.Binary;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileTests
{
    internal static int Run()
    {
        int passed = 0;
        void Test(string name, Action body)
        {
            try { body(); passed++; Console.WriteLine("PASS " + name); }
            catch { Console.WriteLine("FAIL " + name); throw; }
        }
        var scope = new FileScope(@"C:\fixture", false);
        FileInput Input(int id, long qpc, ulong obj = 1, ulong key = 0, string? name = null) =>
            new((ulong)qpc, id, id == 10 ? 0 : 1, qpc, 71, 72, 72, null, obj, key, name);
        FileMapping Map(int cap = 32768, int bytes = 8 * 1024 * 1024) => new(scope, 10, cap, bytes);
        void Name(FileMapping map, long qpc = 1, ulong obj = 1, ulong key = 0, string path = @"C:\fixture\a") =>
            map.Accept(Input(12, qpc, obj, key, path));
        Test("native layout", FileTrace.Layout);
        Test("scope boundary and device spelling", () =>
        {
            Check(scope.Select(@"C:\fixture2\a") == null);
            Check(scope.Select(@"\??\C:\fixture\a") == @"C:\fixture\a");
            Check(scope.Select(@"C:\fixture\..\outside") == null);
            Check(scope.Select("C:\\fixture\\x\nsecret") == null);
        });
        Test("reject broad or ambiguous roots", () =>
        {
            foreach (var root in new[] { @"C:\", @"C:\fixture\..\a", @"\\server\share", "C:\\fixture " })
                Reject(() => new FileScope(root, false));
        });
        Test("preopened remains unresolved; no backfill", () =>
        {
            var map = Map(); var first = map.Accept(Input(15, 1)); Name(map, 2);
            Check(first?.path == null); Check(map.Accept(Input(15, 3))?.pathEvidence == "candidate-object");
        });
        Test("earlier name yields candidate only", () =>
        {
            var map = Map(); Name(map); var value = map.Accept(Input(15, 2));
            Check(value?.path == @"C:\fixture\a" && value.generationWitness == null && value.agent == null && value.instanceId == null);
        });
        Test("PID reuse never carries cached birth", () =>
        {
            var map = Map(); Name(map);
            var a = map.Accept(Input(15, 2))! with { generationWitness = "134000000000001111", generationStatus = "candidate" };
            var b = map.Accept(Input(15, 3)); Check(a.generationWitness != null && b?.generationWitness == null);
        });
        Test("same QPC is insufficient ordering", () => { var map = Map(); Name(map); Check(map.Accept(Input(15, 1))?.path == null); });
        Test("late event clears mapping epoch", () =>
        {
            var map = Map(); Name(map, 5); Check(map.Accept(Input(15, 4))?.path == null);
            Check(map.Accept(Input(15, 6))?.path == null && map.Resets > 0);
        });
        Test("close and cleanup retire related evidence", () =>
        {
            foreach (int id in new[] { 13, 14 }) { var map = Map(); Name(map, key: 2); map.Accept(Input(id, 2)); Check(map.Accept(Input(15, 3, key: 2))?.path == null); }
        });
        Test("conflicting object and key are unresolved", () =>
        {
            var map = Map(); Name(map); Name(map, 2, 0, 2, @"C:\fixture\b");
            var result = map.Accept(Input(15, 3, key: 2)); Check(result?.pathEvidence == "conflict" && result.path == null && map.Count == 0);
        });
        Test("rebind outside root cannot keep old path", () =>
        {
            var map = Map(); Name(map); Name(map, 2, path: @"C:\outside\secret"); Check(map.Accept(Input(15, 3))?.path == null);
        });
        Test("TTL expiry is unresolved", () => { var map = Map(); Name(map); Check(map.Accept(Input(15, 302))?.path == null); });
        Test("map cap invalidates whole epoch", () =>
        {
            var map = Map(1); Name(map); Name(map, 2, 2); Check(map.Count == 0 && map.Resets == 1);
        });
        Test("map byte bound includes retained strings", () => { var map = Map(bytes: 10); Name(map); Check(map.Count == 0 && map.Bytes == 0); });
        Test("loss boundary rejects buffered names", () =>
        {
            var map = Map(); Name(map); map.Reset(10); Name(map, 5); Check(map.Accept(Input(15, 11))?.path == null);
            Name(map, 12); Check(map.Accept(Input(15, 13))?.path != null);
        });
        Test("ingress overflow accounts retained evidence too", () =>
        {
            var queue = new FileIngress(1); queue.Enqueue(Input(12, 1)); queue.Enqueue(Input(15, 2));
            Check(queue.Take().Gap); Check(queue.Totals() == (2UL, 2UL, 0UL)); Check(queue.Take().Input == null);
        });
        Test("ingress byte cap and decoder loss", () =>
        {
            var queue = new FileIngress(byteCap: 100); queue.Enqueue(Input(15, 1)); queue.DecodeError();
            Check(queue.Take().Gap && queue.Totals() == (2UL, 1UL, 1UL));
        });
        Test("sustained ingress overload remains bounded", () =>
        {
            var queue = new FileIngress();
            for (int i = 1; i <= 100000; i++) queue.Enqueue(Input(15, i));
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(queue.Queues()));
            Check(json.RootElement.GetProperty("records").GetInt32() <= 4096);
            Check(json.RootElement.GetProperty("bytes").GetInt32() <= 4 * 1024 * 1024);
            Check(queue.Take().Gap && queue.Totals().Dropped == 100000);
        });
        Test("mapper drains independently of an unread output queue", () =>
        {
            var queue = new FileIngress();
            using var pipeline = new FilePipeline(queue, scope, false);
            for (int batch = 0; batch < 80; batch++)
            {
                long qpc = batch * 1000 + 1;
                queue.Enqueue(Input(12, qpc, name: @"C:\fixture\a"));
                for (int i = 1; i <= 100; i++) queue.Enqueue(Input(15, qpc + i));
                Check(SpinWait.SpinUntil(() => queue.Snapshot().Records == 0, 2000));
            }
            pipeline.Complete(); pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(pipeline.Queues()));
            Check(json.RootElement.GetProperty("records").GetInt32() <= 4096);
            Check(json.RootElement.GetProperty("bytes").GetInt32() <= 4 * 1024 * 1024);
            Check(pipeline.OutputDropped > 0 && queue.Totals().Dropped == 0); // Outbound cap, while ingress keeps draining.
            pipeline.Invalidate(1000000); Check(pipeline.Take() == null);
        });
        Test("wire round trip and replay rejection", () =>
        {
            using var stream = new MemoryStream(); var writer = new FileWire("launch", "session");
            writer.Write(stream, "stop", new { requestId = "stop1" }, default).GetAwaiter().GetResult();
            stream.Position = 0; var reader = new FileWire("launch", "session");
            Check(reader.Read(stream, true, default).GetAwaiter().GetResult().t == "stop"); stream.Position = 0;
            Reject(() => reader.Read(stream, true, default).GetAwaiter().GetResult());
        });
        Test("oversize prefix and foreign session rejected", () =>
        {
            byte[] bytes = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(bytes, FileWire.Limit + 1);
            Reject(() => new FileWire("l", "s").Read(new MemoryStream(bytes), true, default).GetAwaiter().GetResult());
            using var stream = new MemoryStream(); new FileWire("foreign", "s").Write(stream, "ping", new { }, default).GetAwaiter().GetResult();
            stream.Position = 0; Reject(() => new FileWire("l", "s").Read(stream, true, default).GetAwaiter().GetResult());
        });
        Test("control objects reject unknown and duplicate fields", () =>
        {
            foreach (string json in new[] { "{\"requestId\":\"a\",\"path\":\"secret\"}", "{\"requestId\":\"a\",\"requestId\":\"b\"}" })
            {
                using var doc = JsonDocument.Parse(json); Reject(() => FileWire.Shape(doc.RootElement, "requestId"));
            }
        });
        FileBurstTests.Run(Test);
        FileOutputTests.Run(Test);
        FilePerformanceTests.Run(Test);
        FileOutputProfileTests.Run(Test);
        FileWakeTests.Run(Test);
        Console.WriteLine($"{passed} self-tests passed; no ETW session or UAC requested.");
        return 0;
    }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("check-failed"); }
    private static void Reject(Action value)
    {
        bool rejected = false; try { value(); } catch { rejected = true; }
        Check(rejected);
    }
}
