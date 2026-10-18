using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileOrphanCollector
{
    internal static async Task<FileOrphanOwner?> Start(string[] args, Stream pipe, Process broker,
        FileGuardOwner? guard, FileGuardOwner? fallback, string? reservation)
    {
        if (args.Length != 11) return null;
        if (args[10] != "orphan-custody" || guard == null || fallback == null || reservation == null)
            throw new InvalidDataException();
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        var setup = await FileGuardWire.Read<FileOrphanSetup>(pipe, limit.Token);
        var owner = await FileOrphanOwner.Start(setup, reservation, broker, guard, fallback,
            args[0] == "custodian-exit-collector" ? "exit-check" :
            args[0] == "orphan-denial-collector" ? "denial-check" : "normal");
        try { await FileGuardWire.Write(pipe, owner.Identity, limit.Token); return owner; }
        catch { owner.Dispose(); throw; }
    }
    internal static async Task Pause(FileOrphanOwner? owner, string phase, Stream pipe, FileWire read)
    {
        if (owner == null) throw new InvalidDataException();
        await owner.Phase(phase);
        // A deliberate diagnostic boundary. Main's abrupt exit closes this channel;
        // no parent-exit wait can deadlock the broker that is waiting for us.
        while (true)
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var command = await read.Read(pipe, true, limit.Token);
            if (command.t != "ping") throw new IOException();
        }
    }
}
