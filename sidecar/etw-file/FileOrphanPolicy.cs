namespace Aegis.EtwLifecycle;

// The new authority must include original main in its exit gate.
internal static class FileOrphanPolicy
{
    internal static FileGuardResult Recover(string? reservation, bool[] originalExits,
        Func<string, FileGuardResult>? recover = null)
    {
        if (originalExits.Length != 5 || originalExits.Any(gone => !gone))
            return new("unverified", false, false, null, null);
        return FileBrokerRecovery.Recover(reservation, true, true, true, recover);
    }
}
