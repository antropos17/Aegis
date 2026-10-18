namespace Aegis.EtwLifecycle;

// The fallback has its own authenticated reservation and retained original peer
// objects. A timeout, pipe EOF or PID alone cannot authorize it to control ETW.
internal static class FileRecoveryPolicy
{
    internal static FileGuardResult Recover(string reservation, bool collectorGone, bool guardGone,
        Func<string, FileGuardResult>? recover = null)
    {
        if (!collectorGone || !guardGone) return new("unverified", false, false, null, null);
        return recover != null ? recover(reservation) : FileTrace.RecoverReservation(reservation);
    }

    internal static (FileGuardResult Receipt, bool Fallback) Select(int collectorExit, int guardExit, int fallbackExit,
        FileGuardResult? primary, FileGuardResult? fallback)
    {
        bool Complete(FileGuardResult? r) => r != null && r.stopped && r.absent && r.kind is "recovered" or "disarmed";
        if (fallbackExit != 0 || !Complete(fallback) || fallback!.guardExit != guardExit ||
            (fallback.kind == "recovered" && fallback.collectorExit != collectorExit) ||
            (fallback.kind == "disarmed" && (guardExit != 0 || fallback.collectorExit != null))) throw new IOException();
        if (guardExit == 0 && Complete(primary) &&
            (primary!.collectorExit == null || primary.collectorExit == collectorExit)) return (primary, false);
        if (fallback.kind != "recovered") throw new IOException();
        return (fallback, true);
    }
}
