namespace Aegis.EtwLifecycle;

internal static class FileGroupRecovery
{
    internal static FileGuardResult Recover(string? reservation, bool[] originalExits,
        Func<string, FileGuardResult>? recover = null)
    {
        if (originalExits.Length != 4 || originalExits.Any(gone => !gone))
            return new("unverified", false, false, null, null);
        return FileBrokerRecovery.Recover(reservation, true, true, true, recover);
    }
}
