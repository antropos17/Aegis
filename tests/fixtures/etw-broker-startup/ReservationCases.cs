using System.Buffers.Binary;
using System.Reflection;
using System.Text.Json;
using static BrokerStartupFixture.BrokerSession;

namespace BrokerStartupFixture;

internal static class ReservationCases
{
    private static readonly Assembly Production = Assembly.Load("EtwFile");
    private static readonly Type Startup = Production.GetType("Aegis.EtwLifecycle.FileGuardStartup", true)!;
    private static readonly MethodInfo Read = Production.GetType("Aegis.EtwLifecycle.FileGuardOwner", true)!
        .GetMethod("ReadReserved", BindingFlags.NonPublic | BindingFlags.Static)!;
    private static readonly string[] Checkpoints = ["guard-owner-verified", "guard-broker-connected", "guard-broker-verified"];
    private static byte[] Frame(object value)
    {
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(value), frame = new byte[4 + json.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame, json.Length); json.CopyTo(frame, 4); return frame;
    }
    private static object Packet(string kind) => new { kind, handle = (string?)null, guid = (string?)null };
    private static async Task Observe(bool selected, object[] frames, bool accept, string[] expected)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var neverExited = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var startup = (IDisposable)Activator.CreateInstance(Startup, BindingFlags.Instance | BindingFlags.NonPublic,
            null, [neverExited.Task, (Func<int>)(() => 0), deadline.Token], null)!;
        using var stream = new MemoryStream(frames.SelectMany(Frame).ToArray());
        var observed = new List<string>();
        var run = (Task)Read.Invoke(null, [startup, stream, selected, (Action<string>)(value => observed.Add(value))])!;
        if (accept) await run;
        else
        {
            try { await run; throw new InvalidOperationException("Reservation accepted without required proof."); }
            catch (Exception error) when (error is InvalidDataException or EndOfStreamException) { }
        }
        Require(observed.SequenceEqual(expected), "unexpected or reordered diagnostic callback");
    }
    internal static Task Ordinary() => Observe(false, [Packet("reserved")], true, []);
    internal static Task Ordered() => Observe(true, [.. Checkpoints.Select(Packet), Packet("reserved")], true, Checkpoints);
    internal static async Task Refusals()
    {
        await Observe(false, [Packet(Checkpoints[0]), Packet("reserved")], false, []);
        await Observe(true, [Packet("reserved")], false, []);
        await Observe(true, [Packet(Checkpoints[0])], false, [Checkpoints[0]]);
        await Observe(true, [Packet(Checkpoints[1]), Packet("reserved")], false, []);
        await Observe(true, [Packet(Checkpoints[0]), Packet(Checkpoints[0]), Packet("reserved")], false, [Checkpoints[0]]);
        await Observe(true, [new { kind = Checkpoints[0], handle = "1", guid = (string?)null }], false, []);
        await Observe(true, [new { kind = Checkpoints[0], handle = (string?)null, guid = (string?)null, extra = true }], false, []);
    }
    internal static async Task Gating()
    {
        var diagnostic = Production.GetType("Aegis.EtwLifecycle.FileQualificationDiagnostic", true)!;
        var method = diagnostic.GetMethod("GuardCheckpoint", BindingFlags.NonPublic | BindingFlags.Static)!;
        string flag = (string)diagnostic.GetField("GuardVariable", BindingFlags.NonPublic | BindingFlags.Static)!.GetRawConstantValue()!;
        string policy = (string)Production.GetType("Aegis.EtwLifecycle.FileQualificationPolicy", true)!
            .GetField("Variable", BindingFlags.NonPublic | BindingFlags.Static)!.GetRawConstantValue()!;
        string? previousFlag = Environment.GetEnvironmentVariable(flag), previousPolicy = Environment.GetEnvironmentVariable(policy);
        try
        {
            (string? Flag, string? Marker)[] inputs = [(null, null), ("1", null), (null, "fixture"), ("1", "fixture")];
            foreach (var input in inputs)
            {
                Environment.SetEnvironmentVariable(flag, input.Flag); Environment.SetEnvironmentVariable(policy, input.Marker);
                using var stream = new MemoryStream();
                await (Task)method.Invoke(null, [stream, Checkpoints[0]])!;
                Require((stream.Length > 0) == (input.Flag == "1" && input.Marker != null), "diagnostic escaped explicit double opt-in");
            }
        }
        finally { Environment.SetEnvironmentVariable(flag, previousFlag); Environment.SetEnvironmentVariable(policy, previousPolicy); }
    }
}
