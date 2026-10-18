namespace Aegis.EtwLifecycle;

internal static class FileRecoveryTests
{
    internal static void Run(Action<string, Action> test)
    {
        var reservation = Guid.NewGuid().ToString("N");
        var receipt = new FileGuardResult("recovered", true, true, new(0, 7, 0, 0, null, null), 70, "123", 71);
        void Check(bool value) { if (!value) throw new InvalidOperationException("fallback-proof"); }
        test("fallback recovers the original reservation after both retained peers exit", () =>
        {
            int calls = 0;
            var result = FileRecoveryPolicy.Recover(reservation, true, true, original =>
            { Check(original == reservation); calls++; return receipt; });
            Check(result == receipt && calls == 1);
        });
        test("fallback never controls ETW while either original peer is alive", () =>
        {
            foreach (var pair in new[] { (true, false), (false, true), (false, false) })
            {
                var result = FileRecoveryPolicy.Recover(reservation, pair.Item1, pair.Item2,
                    _ => throw new InvalidOperationException("must-not-control"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("broker accepts matching fallback receipt after primary guard loss", () =>
        {
            var selected = FileRecoveryPolicy.Select(70, 71, 0, null, receipt);
            Check(selected.Fallback && selected.Receipt == receipt);
        });
        test("broker rejects mismatched exits, incomplete cleanup and missing fallback", () =>
        {
            foreach (var candidate in new FileGuardResult?[] { null, receipt with { collectorExit = 0 },
                receipt with { guardExit = 0 }, receipt with { stopped = false }, receipt with { absent = false },
                receipt with { kind = "unverified" }, receipt with { kind = "disarmed", collectorExit = null } })
            {
                bool rejected = false;
                try { FileRecoveryPolicy.Select(70, 71, 0, null, candidate); } catch (IOException) { rejected = true; }
                Check(rejected);
            }
            bool exitRejected = false;
            try { FileRecoveryPolicy.Select(70, 71, 2, null, receipt); } catch (IOException) { exitRejected = true; }
            Check(exitRejected);
        });
        test("healthy primary counters survive the fallback's later absence-only receipt", () =>
        {
            var primary = receipt with { guardExit = null };
            var fallback = receipt with { counters = new(4201, null, null, null, null, null), guardExit = 0 };
            var selected = FileRecoveryPolicy.Select(70, 0, 0, primary, fallback);
            Check(!selected.Fallback && selected.Receipt.counters?.Events == 7);
        });
    }
}
