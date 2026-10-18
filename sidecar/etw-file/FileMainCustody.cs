using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal sealed class FileMainCustody : IDisposable
{
    private readonly FileMainParent owner;
    private readonly List<SafeProcessHandle> copies = [];
    private bool released;
    internal FileMainReservation Reservation { get; }
    internal bool OwnerGone => FileMainHandles.Gone(owner.Handle);
    private FileMainCustody(FileMainParent parent, FileMainReservation reservation) { owner = parent; Reservation = reservation; }

    internal static FileMainCustody Deposit(string reservation, (int Pid, SafeProcessHandle Handle)[] originals)
    {
        FileBrokerRecovery.Reservation(reservation, reservation);
        if (originals.Length != 4 || originals.Select(p => p.Pid).Distinct().Count() != 4) throw new InvalidDataException();
        var parent = FileMainParent.Open(); var deposited = new List<FileMainWitness>();
        try
        {
            var self = Security.Current();
            for (int i = 0; i < originals.Length; i++)
            {
                var proof = Security.Observe(originals[i].Handle, originals[i].Pid);
                if (proof.User != self.User || proof.Logon != self.Logon || proof.Elevated != (i != 0) ||
                    !proof.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
                deposited.Add(FileMainHandles.Deposit(parent.Handle, originals[i].Handle, originals[i].Pid));
            }
            return new(parent, new(reservation, parent.Identity.Pid, parent.Identity.Birth.ToString(), deposited.ToArray()));
        }
        catch
        {
            foreach (var witness in deposited) { try { FileMainHandles.Release(parent.Handle, witness); } catch { } }
            parent.Dispose(); throw;
        }
    }
    internal static FileMainCustody Retrieve(FileMainReservation reservation)
    {
        FileBrokerRecovery.Reservation(reservation.guid, reservation.guid);
        if (reservation.peers.Length != 4 || reservation.peers.Select(p => p.pid).Distinct().Count() != 4 ||
            reservation.peers.Select(p => p.handle).Distinct().Count() != 4) throw new InvalidDataException();
        var parent = FileMainParent.Open(); var custody = new FileMainCustody(parent, reservation);
        try
        {
            if (parent.Identity.Pid != reservation.ownerPid || parent.Identity.Birth.ToString() != reservation.ownerBirth)
                throw new UnauthorizedAccessException();
            foreach (var witness in reservation.peers)
            {
                if (witness.pid == parent.Identity.Pid || witness.pid == Environment.ProcessId) throw new UnauthorizedAccessException();
                custody.copies.Add(FileMainHandles.Retrieve(parent.Handle, witness));
            }
            return custody;
        }
        catch { custody.Dispose(); throw; }
    }
    internal async Task WaitForAllExits()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (copies.Any(p => !FileMainHandles.Gone(p))) await Task.Delay(50, deadline.Token);
    }
    internal bool[] OriginalExits => copies.Select(FileMainHandles.Gone).ToArray();
    internal int[] OriginalCodes => copies.Select(FileMainHandles.ExitCode).ToArray();
    internal void ReleaseDeposits(bool requireAllExited)
    {
        if (released) throw new InvalidOperationException();
        if (requireAllExited && (copies.Count != 4 || copies.Any(p => !FileMainHandles.Gone(p)))) throw new IOException();
        released = true;
        foreach (var witness in Reservation.peers) FileMainHandles.Release(owner.Handle, witness);
    }
    public void Dispose()
    {
        foreach (var copy in copies) copy.Dispose();
        owner.Dispose(); // Deposits survive an unverified broker failure in Electron main.
    }
}
