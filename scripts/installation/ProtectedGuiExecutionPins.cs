using System;

// The immutable bundle journal remains the authority across the private handoff.
public sealed class ProtectedGuiExecutionPins
{
    private readonly ProtectedGuiBundleFiles bundle;
    private readonly ProtectedGuiProcessLease owner;
    private bool restored;
    internal readonly string ImagePath, DirectoryPath;
    internal ProtectedGuiExecutionPins(ProtectedGuiBundleFiles original, ProtectedGuiProcessLease lease, string image, string directory)
    { bundle = original; owner = lease; ImagePath = image; DirectoryPath = directory; }
    internal bool OwnedBy(ProtectedGuiProcessLease lease) { return Object.ReferenceEquals(owner, lease) && !restored; }
    internal void Check() { bundle.CheckExecution(this, owner); }
    internal void RestoreAfterJobClosed() { bundle.RestoreExecution(this, owner); restored = true; }
}
