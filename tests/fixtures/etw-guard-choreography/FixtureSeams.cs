using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

// The production owner, guard loop, startup wait and wire are linked unchanged.
// Authentication/native trace calls are controlled: this fixture never elevates,
// authenticates a native production peer, starts ETW or reads application files.
internal readonly record struct FixtureIdentity(int Pid, ulong Birth, bool Elevated);
internal static class Security
{
    internal static NamedPipeServerStream Server(string name) =>
        new("aegis-guard-fixture-" + name, PipeDirection.InOut, 1,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096);
    internal static bool RestrictedAcl(NamedPipeServerStream pipe) => true;
    internal static FixtureIdentity Current() => new(Environment.ProcessId, 1, true);
    internal static FixtureIdentity Observe(Process child)
    {
        Program.RetainChild(child);
        return new(child.Id, 1, true);
    }
    private static int clientCount;
    internal static Stream Client(string id)
    {
        var pipe = new NamedPipeClientStream(".", "aegis-guard-fixture-" + id,
            PipeDirection.InOut, PipeOptions.Asynchronous);
        pipe.Connect(3000);
        Program.Mark("client-connected");
        return Program.GuardMode && Interlocked.Increment(ref clientCount) == 1 ? new ObservedOwnerStream(pipe) : pipe;
    }
    internal static void Verify(Stream pipe, Process expected, ulong birth, bool serverEnd, bool elevated)
    {
        var actual = pipe is ObservedOwnerStream observed ? observed.Pipe : (PipeStream)pipe;
        if (!actual.IsConnected || expected.HasExited || birth != 1) throw new InvalidDataException("fixture-identity");
        Program.Mark(serverEnd ? "server-verified" : elevated ? "owner-verified" : "broker-verified");
    }
}

internal sealed record FileStats(int Status);
internal sealed record FileTraceToken(string Handle, string Guid);
internal sealed record FixtureTraceControl(FileStats Stats, Guid Identity);
internal static class FileTrace
{
    internal static FixtureTraceControl GuardControl(FileTraceToken token, int operation) =>
        throw new InvalidOperationException("fixture-native-control-forbidden");
    internal static bool GuardAbsent(int status) => status == 4201;
    internal static FileGuardResult Recover(FileTraceToken token) =>
        throw new InvalidOperationException("fixture-native-recovery-forbidden");
    internal static FileGuardResult RecoverReservation(string reservation)
    {
        if (!Guid.TryParseExact(reservation, "N", out var value) || value == Guid.Empty) throw new InvalidDataException();
        Program.Mark("reserved-query-only");
        return new("disarmed", true, true, null, null);
    }
}

internal static class FileQualificationPolicy
{
    internal const string Variable = "AEGIS_ETW_GUARD_CHOREOGRAPHY_FIXTURE";
}

// Closed structural admission only. The public FileWire module has unrelated
// protocol/scope dependencies; all private framing/serialization is production.
internal static class FileWire
{
    internal static void Shape(JsonElement value, string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException();
        var names = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (names.Length != expected.Length || names.Distinct(StringComparer.Ordinal).Count() != names.Length ||
            names.Except(expected, StringComparer.Ordinal).Any()) throw new InvalidDataException();
    }
}
