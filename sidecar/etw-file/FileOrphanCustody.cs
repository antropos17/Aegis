using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal sealed class FileOrphanCustody : IDisposable
{
    private readonly List<SafeProcessHandle> copies = [];
    internal string Reservation { get; }
    internal int[] Pids { get; }
    private FileOrphanCustody(string reservation, FileMainWitness[] peers)
    { Reservation = reservation; Pids = peers.Select(p => p.pid).ToArray(); }
    internal bool[] Exits => copies.Select(FileMainHandles.Gone).ToArray();
    internal int[] Codes => copies.Select(FileMainHandles.ExitCode).ToArray();
    internal FileDurableLease Durable()
    {
        var self = Security.Current();
        var peers = Pids.Select((pid, index) => new FileDurablePeer(pid, FileMainHandles.Birth(copies[index]).ToString())).ToList();
        peers.Add(new(self.Pid, self.Birth.ToString()));
        return new(1, Reservation, self.User, self.Logon, self.Image, peers.ToArray());
    }

    internal static FileOrphanCustody Take(FileOrphanLease lease, int collectorPid, ulong collectorBirth)
    {
        var peers = FileOrphanWire.Witnesses(lease);
        if (peers[2].pid != collectorPid || peers[2].birth != collectorBirth.ToString() ||
            FileMainParent.ParentId(Environment.ProcessId) != collectorPid) throw new UnauthorizedAccessException();
        using var selfHandle = new SafeProcessHandle(new IntPtr(-1), false);
        var custody = new FileOrphanCustody(lease.guid, peers);
        try
        {
            var self = Security.Current();
            for (int i = 0; i < peers.Length; i++)
            {
                var copy = FileMainHandles.Retrieve(selfHandle, peers[i]); custody.copies.Add(copy);
                var actual = Security.Observe(copy, peers[i].pid);
                string image = i == 0 ? FileMainParent.PackagedImage : Program.Executable;
                if (FileMainHandles.Gone(copy) || actual.User != self.User || actual.Logon != self.Logon ||
                    actual.Elevated != (i >= 2) || !actual.Image.Equals(image, StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException();
            }
            if (FileMainParent.ParentId(peers[1].pid) != peers[0].pid ||
                FileMainHandles.Birth(custody.copies[0]) >= FileMainHandles.Birth(custody.copies[1]))
                throw new UnauthorizedAccessException();
            // Only after all five identities are proved may their local deposits be closed.
            // CLOSE_SOURCE is attempted once; invalid imported values never reach it.
            foreach (var peer in peers) FileMainHandles.Release(selfHandle, peer);
            return custody;
        }
        catch { custody.Dispose(); throw; }
    }
    public void Dispose() { foreach (var copy in copies) copy.Dispose(); }
}
