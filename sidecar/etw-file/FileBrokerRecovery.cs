namespace Aegis.EtwLifecycle;

// The normal broker retains this capture's private reservation, independently
// authenticated before StartTrace. No permission, token or service is installed.
internal static class FileBrokerRecovery
{
    internal static string Reservation(string first, string second)
    {
        if (first != second || !Guid.TryParseExact(first, "N", out var guid) || guid == Guid.Empty || guid.ToString("N") != first)
            throw new InvalidDataException();
        return first;
    }

    internal static FileGuardResult Recover(string? reservation, bool collectorGone, bool guardGone, bool fallbackGone,
        Func<string, FileGuardResult>? recover = null)
    {
        if (!collectorGone || !guardGone || !fallbackGone ||
            !Guid.TryParseExact(reservation, "N", out var guid) || guid == Guid.Empty || guid.ToString("N") != reservation)
            return new("unverified", false, false, null, null);
        return recover != null ? recover(reservation) : FileTrace.RecoverReservation(reservation);
    }
}
