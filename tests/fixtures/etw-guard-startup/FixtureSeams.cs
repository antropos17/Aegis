using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

// Only the startup wait/owner/diagnostic sources are linked. These seams never
// invoke ETW, authenticate a production peer, elevate, or read application data.
internal readonly record struct FixtureIdentity(int Pid, ulong Birth);
internal static class Security
{
    internal static NamedPipeServerStream Server(string name) =>
        new(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
    internal static bool RestrictedAcl(NamedPipeServerStream pipe) => true;
    internal static FixtureIdentity Current() => new(Environment.ProcessId, 1);
    internal static FixtureIdentity Observe(Process child) => new(child.Id, 1);
    internal static void Verify(NamedPipeServerStream pipe, Process child, ulong birth, bool server, bool inheritable) =>
        throw new InvalidOperationException("Unexpected authentication after child exit.");
}

internal sealed record FileGuardHello(int pid, string birth, string guid);
internal sealed record FileGuardCommand(string kind, string? handle = null, string? guid = null);
internal sealed record FileFallbackReservation(string guid, int guardPid, string guardBirth);
internal sealed record FileGuardResult(string kind, bool stopped, bool absent);
internal sealed record FileTraceToken(string Handle, string Guid);
internal static class FileGuardWire
{
    internal static Task Write<T>(Stream stream, T value, CancellationToken token) =>
        throw new InvalidOperationException("Unexpected protocol write after child exit.");
    internal static Task<T> Read<T>(Stream stream, CancellationToken token) =>
        throw new InvalidOperationException("Unexpected protocol read after child exit.");
}

internal static class FileQualificationPolicy
{
    internal const string Variable = "AEGIS_ETW_GUARD_STARTUP_FIXTURE_QUALIFICATION";
}

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
