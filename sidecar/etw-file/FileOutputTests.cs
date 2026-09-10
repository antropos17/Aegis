using System.Buffers.Binary;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileOutputTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("output frames preserve record order, fields and actual byte budgets", () =>
        {
            var original = Enumerable.Range(1, 400).Select(i => Observation(i, @"C:\fixture\тест&" + i) with
            {
                generationStatus = "candidate",
                generationWitness = "9007199254740993",
                generationSource = "createTime100ns",
                generationInterval = new { fromQpc = "5", toQpc = "6" }
            }).ToArray();
            var input = new Queue<FileObservation>(original);
            using var stream = new MemoryStream();
            var wire = new FileWire("launch", "session");
            while (wire.WriteObservations(stream, () => input.TryDequeue(out var value) ? value : null, default).GetAwaiter().GetResult()) { }
            stream.Position = 0;
            var reader = new FileWire("launch", "session");
            int count = 0, frames = 0;
            while (stream.Position < stream.Length)
            {
                var envelope = reader.Read(stream, false, default).GetAwaiter().GetResult();
                Check(envelope.t == "observations" && envelope.seq == (++frames).ToString(), "envelope-order");
                var records = envelope.data.GetProperty("records");
                Check(records.GetArrayLength() is > 0 and <= 128, "record-cap");
                int bytes = 0;
                foreach (var value in records.EnumerateArray())
                {
                    Check(bytes < 32 * 1024, "batch-started-record-past-target");
                    Check(JsonElement.DeepEquals(value, JsonSerializer.SerializeToElement(original[count++])), "changed-or-reordered-record");
                    bytes += System.Text.Encoding.UTF8.GetByteCount(value.GetRawText());
                }
            }
            Check(count == original.Length && frames > 1, "incomplete-batches");
        });
        test("maximal escaped selected path fits one bounded output frame", () =>
        {
            // Ampersands expand to six JSON bytes each with the default encoder.
            var input = new Queue<FileObservation>([
                Observation(1), Observation(2, @"C:\fixture\" + new string('&', 32700))]);
            using var stream = new MemoryStream();
            var wire = new FileWire("launch", "session");
            Check(wire.WriteObservations(stream, () => input.TryDequeue(out var value) ? value : null, default).GetAwaiter().GetResult(), "missing-frame");
            Check(input.Count == 0 && stream.Length <= FileWire.Limit + 4, "frame-cap");
            stream.Position = 0;
            var data = new FileWire("launch", "session").Read(stream, false, default).GetAwaiter().GetResult().data;
            Check(data.GetProperty("records")[1].GetProperty("path").GetString()!.Length == 32711, "escaped-path-changed");
        });
        test("oversize output is rejected before any bytes or sequence are written", () =>
        {
            using var stream = new MemoryStream();
            var wire = new FileWire("launch", "session");
            bool rejected = false;
            try { wire.WriteObservations(stream, () => Observation(1) with { path = new string('&', FileWire.Limit) }, default).GetAwaiter().GetResult(); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected && stream.Length == 0, "oversize-written");
            wire.Write(stream, "ping", new { }, default).GetAwaiter().GetResult();
            stream.Position = 0;
            Check(new FileWire("launch", "session").Read(stream, true, default).GetAwaiter().GetResult().seq == "1", "unwritten-sequence-consumed");
            var buffer = new FileFrameBuffer();
            buffer.GetMemory(FileWire.Limit + 1);
            rejected = false;
            try { buffer.Advance(FileWire.Limit + 1); } catch (InvalidDataException) { rejected = true; }
            Check(rejected && buffer.Written.Length == 0, "reservation-bypassed-wire-cap");
        });
        test("empty polls do not allocate frames or consume sequence numbers", () =>
        {
            using var stream = new MemoryStream();
            var wire = new FileWire("launch", "session");
            wire.WriteObservations(stream, () => null, default).GetAwaiter().GetResult();
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 100; i++)
                Check(!wire.WriteObservations(stream, () => null, default).GetAwaiter().GetResult(), "empty-write");
            Check(GC.GetAllocatedBytesForCurrentThread() - before < 64 * 1024, "empty-frame-allocation");
            Check(stream.Length == 0, "empty-frame-written");
            wire.Write(stream, "ping", new { }, default).GetAwaiter().GetResult();
            stream.Position = 0;
            Check(new FileWire("launch", "session").Read(stream, true, default).GetAwaiter().GetResult().seq == "1", "empty-sequence-consumed");
        });
        test("cancelled output does not consume records", () =>
        {
            using var stream = new MemoryStream();
            using var cancel = new CancellationTokenSource(); cancel.Cancel();
            int reads = 0;
            try { new FileWire("launch", "session").WriteObservations(stream, () => { reads++; return Observation(1); }, cancel.Token).GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            Check(reads == 0 && stream.Length == 0, "cancelled-consumption");
        });
        test("single-pass output allocates less than the previous three-pass batch writer", () =>
        {
            var records = Enumerable.Range(1, 200).Select(i => Observation(i)).ToArray();
            long Measure(bool legacy)
            {
                using var stream = new MemoryStream(FileWire.Limit);
                var wire = new FileWire("launch", "session");
                long start = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 30; i++)
                {
                    stream.SetLength(0); stream.Position = 0;
                    if (legacy) LegacyBatch(stream, records);
                    else
                    {
                        int index = 0;
                        wire.WriteObservations(stream, () => records[index++], default).GetAwaiter().GetResult();
                    }
                }
                return GC.GetAllocatedBytesForCurrentThread() - start;
            }
            Measure(true); Measure(false); // Warm serializer metadata and async paths.
            long previous = Measure(true), current = Measure(false);
            Console.WriteLine($"OUTPUT_ALLOC bytes: previous={previous}, current={current}, batches=30");
            Check(current < previous * 0.75, "allocation-regression");
        });
    }

    // Test-only reconstruction of the writer replaced by this change.
    private static void LegacyBatch(Stream stream, FileObservation[] source)
    {
        var records = new List<FileObservation>();
        int bytes = 0;
        for (int i = 0; i < 128 && bytes < 32 * 1024; i++)
        {
            bytes += JsonSerializer.SerializeToUtf8Bytes(source[i]).Length;
            records.Add(source[i]);
        }
        byte[] body = JsonSerializer.SerializeToUtf8Bytes(new Envelope("observations", FileWire.Protocol,
            "launch", "session", "1", JsonSerializer.SerializeToElement(new { records })));
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, body.Length);
        stream.Write(header); stream.Write(body); stream.Flush();
    }
    private static FileObservation Observation(int seq, string path = @"C:\fixture\a")
    {
        var map = new FileMapping(new FileScope(@"C:\fixture", false), 1000000);
        map.Accept(new(1, 12, 1, 1, 71, 72, 72, null, 1, 0, path));
        return map.Accept(new((ulong)seq, 15, 1, 2, 71, 72, 72, null, 1, 0, null))!;
    }
    private static void Check(bool value, string reason)
    {
        if (!value) throw new InvalidOperationException(reason);
    }
}
