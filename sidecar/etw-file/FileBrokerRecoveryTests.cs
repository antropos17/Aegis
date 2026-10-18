namespace Aegis.EtwLifecycle;

internal static class FileBrokerRecoveryTests
{
    internal static void Run(Action<string, Action> test)
    {
        string original = Guid.NewGuid().ToString("N");
        var receipt = new FileGuardResult("recovered", true, true, new(0, 7, 0, 0, null, null), null, "123");
        void Check(bool value) { if (!value) throw new InvalidOperationException("broker-recovery-proof"); }
        test("normal broker recovers its private reservation after all three original peers exit", () =>
        {
            int calls = 0;
            var result = FileBrokerRecovery.Recover(original, true, true, true,
                value => { Check(value == original); calls++; return receipt; });
            Check(result == receipt && calls == 1);
        });
        test("normal broker never controls ETW while any original helper is alive", () =>
        {
            for (int mask = 0; mask < 7; mask++)
            {
                var result = FileBrokerRecovery.Recover(original, (mask & 1) != 0, (mask & 2) != 0, (mask & 4) != 0,
                    _ => throw new InvalidOperationException("must-not-control"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("normal broker requires canonical matching reservations from the authenticated setup", () =>
        {
            Check(FileBrokerRecovery.Reservation(original, original) == original);
            foreach (var pair in new[] { (original, Guid.NewGuid().ToString("N")), (original.ToUpperInvariant(), original),
                ("", ""), (Guid.Empty.ToString("N"), Guid.Empty.ToString("N")) })
            {
                bool rejected = false;
                try { FileBrokerRecovery.Reservation(pair.Item1, pair.Item2); } catch (InvalidDataException) { rejected = true; }
                Check(rejected);
            }
            foreach (string? value in new[] { null, "", "foreign-name", Guid.Empty.ToString("N") })
            {
                var result = FileBrokerRecovery.Recover(value, true, true, true,
                    _ => throw new InvalidOperationException("must-not-query"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("normal broker preserves denied, foreign and unknown recovery results", () =>
        {
            foreach (uint status in new uint[] { 5, 87 })
            {
                var denied = new FileGuardResult("unverified", false, false, new(status, null, null, null, null, null), null);
                var result = FileBrokerRecovery.Recover(original, true, true, true, _ => denied);
                Check(result == denied && !result.absent && !result.stopped);
            }
        });
        test("only actual access denial can request cleanup consent", () =>
        {
            foreach (uint code in new uint[] { 0, 5, 6, 87, 4201 })
            {
                var r = receipt with { stopped = false, absent = false, counters = new(code, null, null, null, null, null) };
                Check(FileRecoveryAccess.NeedsConsent(r) == (code == 5));
                Check(!FileRecoveryAccess.NeedsConsent(r with { stopped = true, absent = true }));
            }
            Check(!FileRecoveryAccess.NeedsConsent(receipt with { stopped = false, absent = false, counters = null }));
        });
    }
}
