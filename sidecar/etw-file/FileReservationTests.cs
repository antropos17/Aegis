namespace Aegis.EtwLifecycle;

internal static class FileReservationTests
{
    internal static void Run(Action<string, Action> test)
    {
        var expected = Guid.NewGuid();
        FileStats Stats(uint code) => new(code, code == 0 ? 0u : null, code == 0 ? 0u : null,
            code == 0 ? 0u : null, null, null);
        void Check(bool value) { if (!value) throw new InvalidOperationException("reservation-proof"); }
        test("pre-arm recovery stops only the reserved session by independently rechecked handle", () =>
        {
            var calls = new List<uint>();
            var result = FileTrace.RecoverReservation(expected.ToString("N"), () => new(Stats(0), expected, 123), code =>
            { calls.Add(code); return (Stats(calls.Count == 3 ? 4201u : 0u), expected); });
            Check(result.stopped && result.absent && calls.SequenceEqual(new uint[] { 0, 1, 0 }));
        });
        test("pre-start reservation absence is distinct from a successful measured stop", () =>
        {
            var result = FileTrace.RecoverReservation(expected.ToString("N"), () => new(Stats(4201), Guid.Empty, 0),
                _ => throw new InvalidOperationException("must-not-stop"));
            Check(result.absent && result.stopped && result.counters?.Status == 4201 && result.counters.Events == null);
        });
        test("foreign occupied name and failed reservation query never grant stop authority", () =>
        {
            foreach (var value in new[] { new FileTraceLookup(Stats(0), Guid.NewGuid(), 123),
                new FileTraceLookup(Stats(5), expected, 123), new FileTraceLookup(Stats(87), expected, 0),
                new FileTraceLookup(Stats(0), expected, 0) })
            {
                var result = FileTrace.RecoverReservation(expected.ToString("N"), () => value,
                    _ => throw new InvalidOperationException("must-not-control"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("a changed handle target is rechecked and never stopped", () =>
        {
            var calls = new List<uint>();
            var result = FileTrace.RecoverReservation(expected.ToString("N"), () => new(Stats(0), expected, 123), code =>
            { calls.Add(code); return (Stats(0), Guid.NewGuid()); });
            Check(!result.stopped && !result.absent && calls.SequenceEqual(new uint[] { 0 }));
        });
    }
}
