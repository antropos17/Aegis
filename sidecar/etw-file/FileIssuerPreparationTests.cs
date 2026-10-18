using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileIssuerPreparationTests
{
    internal static void Run(Action<string, Action> test)
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("preparation-contract"); }
        void Reject(string json)
        {
            bool rejected = false;
            try { using var doc = JsonDocument.Parse(json); FileIssuerRequest.Parse(doc.RootElement); }
            catch { rejected = true; }
            Check(rejected);
        }
        test("issuer requests reject duplicate or extra fields and ambiguous process targets", () =>
        {
            const string target = "{\"pid\":71,\"createTime100ns\":\"134000000000001111\"}";
            foreach (string json in new[] {
                "{\"requestId\":\"p\",\"issuers\":[],\"content\":\"PRIVATE\"}",
                "{\"requestId\":\"p\",\"requestId\":\"p\",\"issuers\":[]}",
                "{\"requestId\":\"p\",\"issuers\":[" + target + "," + target + "]}",
                "{\"requestId\":\"p\",\"issuers\":[{\"pid\":71,\"createTime100ns\":\"01\"}]}",
                "{\"requestId\":\"p\",\"issuers\":[{\"pid\":0,\"createTime100ns\":\"1\"}]}",
                "{\"requestId\":\"p\",\"issuers\":[{\"pid\":71,\"pid\":71,\"createTime100ns\":\"1\"}]}"
            }) Reject(json);
            Reject(JsonSerializer.Serialize(new { requestId = "p", issuers = Enumerable.Range(1, 17)
                .Select(pid => new { pid, createTime100ns = "134000000000001111" }) }));
        });
        test("preparation request wakes the reader, stays bounded and survives map invalidation", () =>
        {
            using var pipeline = new FilePipeline(new FileIngress(), new FileScope(@"C:\fixture", false), false);
            var request = new FileIssuerRequest("prepare1", [new(71, "134000000000001111")]);
            try
            {
                pipeline.RequestPreparation(request); Check(pipeline.OutputAvailable.IsCompleted);
                bool rejected = false;
                try { pipeline.RequestPreparation(request); } catch (InvalidDataException) { rejected = true; }
                Check(rejected);
                pipeline.Invalidate(10); Check(pipeline.OutputAvailable.IsCompleted);
                Check(pipeline.TakePreparation() == request && !pipeline.OutputAvailable.IsCompleted);
                Check(pipeline.Prepare(request).prepared.Length == 0); // Synthetic mode performs no native query.
            }
            finally { pipeline.Complete(); pipeline.Worker.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult(); }
        });
        test("correlated preparation frames use the same ordered writer as observations", () =>
        {
            using var stream = new MemoryStream(); var send = new FileWire("l", "s");
            send.Write(stream, "issuers-primed", new FileIssuerPreparation("prepare1", [], "100"), default).GetAwaiter().GetResult();
            send.Write(stream, "heartbeat", new { }, default).GetAwaiter().GetResult();
            stream.Position = 0; var read = new FileWire("l", "s");
            Check(read.Read(stream, false, default).GetAwaiter().GetResult().seq == "1");
            Check(read.Read(stream, false, default).GetAwaiter().GetResult().seq == "2");
        });
    }
}
