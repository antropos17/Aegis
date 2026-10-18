namespace Aegis.EtwLifecycle;

internal static class FileGroupRecoveryTests
{
    internal static void Run(Action<string, Action> test)
    {
        string reservation = "a147b8e58a6f4b6fb82ee699aa3c149e";
        var expected = new FileGuardResult("recovered", true, true, new(4201, null, null, null, null, null), null);
        void Check(bool value) { if (!value) throw new InvalidOperationException("group-custody-proof"); }
        test("main-held original reservation recovers after broker and all three original objects exit", () =>
        {
            int calls = 0;
            var result = FileGroupRecovery.Recover(reservation, [true, true, true, true], value =>
            { Check(value == reservation); calls++; return expected; });
            Check(result == expected && calls == 1);
        });
        test("group recovery never controls ETW while any original object remains alive", () =>
        {
            for (int mask = 0; mask < 15; mask++)
            {
                bool[] gone = Enumerable.Range(0, 4).Select(i => (mask & (1 << i)) != 0).ToArray();
                var result = FileGroupRecovery.Recover(reservation, gone,
                    _ => throw new InvalidOperationException("must-not-control"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("group recovery rejects missing original custody and noncanonical reservations", () =>
        {
            foreach (var gone in new bool[][] { [], [true, true, true], [true, true, true, true, true] })
                Check(!FileGroupRecovery.Recover(reservation, gone, _ => throw new IOException()).absent);
            foreach (string? value in new[] { null, "", "foreign", Guid.Empty.ToString("N"), reservation.ToUpperInvariant() })
                Check(!FileGroupRecovery.Recover(value, [true, true, true, true], _ => throw new IOException()).absent);
        });
    }
}
