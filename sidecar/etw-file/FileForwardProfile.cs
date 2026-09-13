using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aegis.EtwLifecycle;

// One broker outbound loop owns this profile. Read/idle time is excluded.
internal sealed class FileForwardProfile(Func<long>? timestamp = null)
{
    private readonly FileDuration duration = new();
    private long Now() => (timestamp ?? Stopwatch.GetTimestamp)();
    internal async Task Forward(Stream stream, Envelope frame, CancellationToken token)
    {
        long start = Now(); bool success = false;
        try
        {
            if (frame.t is "ready" or "health" or "heartbeat" or "stopped")
            {
                var data = JsonNode.Parse(frame.data.GetRawText())!;
                var telemetry = frame.t is "ready" or "stopped" ? data["telemetry"]! : data;
                // This sample covers completed forwards before the carrying frame.
                telemetry["performance"]!["brokerForward"] = JsonSerializer.SerializeToNode(new
                {
                    asOfQpc = start.ToString(),
                    duration = duration.Snapshot()
                });
                frame = frame with { data = JsonSerializer.SerializeToElement(data) };
            }
            await FileWire.Forward(stream, frame, token); success = true;
        }
        finally { duration.Record(Now() - start, !success); }
    }
}
