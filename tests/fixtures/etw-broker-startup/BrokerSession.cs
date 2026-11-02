using System.Buffers.Binary;
using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace BrokerStartupFixture;

// Native authentication is the only substituted boundary. Framing, validation,
// deadline ownership and connected ACKs execute in the production assembly.
internal sealed class BrokerSession : IAsyncDisposable
{
    internal const int BrokerPid = 100, CollectorPid = 200, PrimaryPid = 300, FallbackPid = 400;
    internal const string Reservation = "123456781234123412341234567890ab";
    internal static readonly TimeSpan Limit = TimeSpan.FromSeconds(4);
    private static readonly MethodInfo Connect = Assembly.Load("EtwFile")
        .GetType("Aegis.EtwLifecycle.FileBrokerStartup", true)!
        .GetMethod("Connect", BindingFlags.NonPublic | BindingFlags.Static)!;
    private readonly NamedPipeServerStream server;
    private readonly NamedPipeClientStream client;
    internal CancellationTokenSource Startup { get; }
    internal int PrimaryCalls, FallbackCalls, CustodyCalls;
    internal Task? Running;

    private BrokerSession(NamedPipeServerStream server, NamedPipeClientStream client, TimeSpan cap)
    { this.server = server; this.client = client; Startup = new(cap); }

    internal static async Task<BrokerSession> Create(TimeSpan? cap = null)
    {
        string name = "aegis-broker-fixture-" + Guid.NewGuid().ToString("N");
        var server = new NamedPipeServerStream(name, PipeDirection.InOut, 1,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
        using var connect = new CancellationTokenSource(Limit);
        await Task.WhenAll(server.WaitForConnectionAsync(connect.Token), client.ConnectAsync(connect.Token));
        return new(server, client, cap ?? Limit);
    }

    internal Task Run(Func<CancellationToken, Task>? primary = null,
        Func<CancellationToken, Task>? fallback = null, Func<CancellationToken, Task>? custody = null,
        TimeSpan? budget = null)
    {
        Func<int, ulong, string, CancellationToken, Task> first = async (pid, birth, guid, token) =>
        {
            Require(pid == PrimaryPid && birth == 123 && guid == Reservation, "primary callback identity");
            PrimaryCalls++;
            if (primary != null) await primary(token);
        };
        Func<int, ulong, string, CancellationToken, Task> second = async (pid, birth, guid, token) =>
        {
            Require(pid == FallbackPid && birth == 456 && guid == Reservation, "fallback callback identity");
            FallbackCalls++;
            if (fallback != null) await fallback(token);
        };
        Func<CancellationToken, Task>? afterAck = custody == null ? null : async token =>
        { CustodyCalls++; await custody(token); };
        return Running = (Task)Connect.Invoke(null,
            [server, BrokerPid, CollectorPid, first, second, afterAck, Startup.Token, budget])!;
    }

    internal Task Hello(bool second = false) => Json(new
    { pid = second ? FallbackPid : PrimaryPid, birth = second ? "456" : "123", guid = Reservation });

    internal Task Json(object value) => Raw(JsonSerializer.Serialize(value));
    internal Task Raw(string json) => Frame(Encoding.UTF8.GetBytes(json));
    internal async Task Frame(byte[] body, int? declared = null)
    {
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, declared ?? body.Length);
        await client.WriteAsync(header, Startup.Token);
        if (body.Length != 0) await client.WriteAsync(body, Startup.Token);
        await client.FlushAsync(Startup.Token);
    }

    internal async Task Ack(TimeSpan? budget = null)
    {
        using var read = new CancellationTokenSource(budget ?? Limit);
        byte[] header = new byte[4]; await client.ReadExactlyAsync(header, read.Token);
        int size = BinaryPrimitives.ReadInt32LittleEndian(header);
        Require(size is > 0 and <= 2048, "ACK frame length");
        byte[] body = new byte[size]; await client.ReadExactlyAsync(body, read.Token);
        using var json = JsonDocument.Parse(body);
        var fields = json.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
        Require(fields.Count == 3 && fields["kind"].GetString() == "connected" &&
            fields["handle"].ValueKind == JsonValueKind.Null && fields["guid"].ValueKind == JsonValueKind.Null,
            "connected ACK content");
    }

    internal async Task NoAck()
    {
        using var probe = new CancellationTokenSource(TimeSpan.FromMilliseconds(60));
        try
        {
            int bytes = await client.ReadAsync(new byte[1], probe.Token);
            Require(false, $"unexpected ACK or EOF ({bytes})");
        }
        catch (OperationCanceledException) when (probe.IsCancellationRequested) { }
    }

    internal static TaskCompletionSource Signal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal static void Require(bool condition, string message)
    { if (!condition) throw new InvalidOperationException(message); }
    internal static async Task Error<T>(Task task) where T : Exception
    {
        try { await task.WaitAsync(Limit); }
        catch (T) { return; }
        throw new InvalidOperationException("Expected " + typeof(T).Name);
    }

    public async ValueTask DisposeAsync()
    {
        Startup.Cancel(); client.Dispose(); server.Dispose();
        if (Running != null) try { await Running.WaitAsync(Limit); } catch { }
        Startup.Dispose();
    }
}
