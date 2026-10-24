namespace Aegis.EtwLifecycle;

internal static class FileOrphanTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("normal terminal observer waits for all original objects and preserves actual exit codes", () =>
        {
            using var value = System.Text.Json.JsonDocument.Parse("{\"kind\":\"terminal\"}");
            var originals = new TaskCompletionSource<int[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            bool custodianObserved = false;
            var observation = FileOrphanObserver.ObserveTerminal(value.RootElement, () =>
                { custodianObserved = true; return Task.CompletedTask; }, () => 0, () => originals.Task);
            Check(custodianObserved && !observation.IsCompleted);
            originals.SetResult([0, 0, 0, 0, 70]);
            var terminal = observation.GetAwaiter().GetResult();
            Check(terminal.custodianExit == 0 && terminal.originalExits!.SequenceEqual(new[] { 0, 0, 0, 0, 70 }));
        });
        test("normal terminal observer never invents missing or timed-out original closure", () =>
        {
            using var value = System.Text.Json.JsonDocument.Parse("{\"kind\":\"terminal\"}");
            var diagnostic = FileOrphanObserver.ObserveTerminal(value.RootElement, () => Task.CompletedTask,
                () => 0, null).GetAwaiter().GetResult();
            Check(diagnostic.originalExits == null);
            Reject(() => FileOrphanObserver.ObserveTerminal(value.RootElement, () => Task.CompletedTask,
                () => 0, () => Task.FromException<int[]>(new TimeoutException())).GetAwaiter().GetResult());
        });
        const string reservation = "12345678123456781234567812345678";
        test("custodian recovers only after all five original objects including main exit", () =>
        {
            int calls = 0;
            var result = FileOrphanPolicy.Recover(reservation, [true, true, true, true, true], value =>
            {
                Check(value == reservation); calls++;
                return new("recovered", true, true, null, null);
            });
            Check(calls == 1 && result.stopped && result.absent);
            for (int live = 0; live < 5; live++)
            {
                bool[] gone = [true, true, true, true, true]; gone[live] = false;
                var denied = FileOrphanPolicy.Recover(reservation, gone, _ => throw new IOException());
                Check(!denied.stopped && !denied.absent);
            }
        });
        test("custodian rejects incomplete original groups and invalid reservations", () =>
        {
            foreach (var gone in new[] { Array.Empty<bool>(), new bool[4], new bool[6] })
                Check(!FileOrphanPolicy.Recover(reservation, gone, _ => throw new IOException()).absent);
            foreach (var value in new string?[] { null, "", new('0', 32), "foreign" })
                Check(!FileOrphanPolicy.Recover(value, [true, true, true, true, true], _ => throw new IOException()).absent);
        });
        test("custodian keeps denied control unverified without inventing recovery", () =>
        {
            var denied = FileOrphanPolicy.Recover(reservation, [true, true, true, true, true],
                _ => new("unverified", false, false, new(5, null, null, null, null, null), null));
            Check(!denied.stopped && !denied.absent && denied.counters?.Status == 5);
        });
        test("custodian observer endpoint is a canonical read-only address", () =>
        {
            Check(FileOrphanWire.Observer(null) == null);
            Check(FileOrphanWire.Observer(reservation + ":71:1000")?.pid == 71);
            foreach (var value in new[] { "", "foreign", reservation + ":0:1000", reservation + ":71:01000",
                new string('0', 32) + ":71:1000", reservation + ":71:9223372036854775808", reservation + ":2147483648:1000" })
                Reject(() => FileOrphanWire.Observer(value));
        });
        test("custodian rejects duplicate nested fields and repeated original object witnesses", () =>
        {
            using var duplicate = System.Text.Json.JsonDocument.Parse("[{\"pid\":1,\"pid\":2,\"handle\":\"1\"},{},{},{},{}]");
            Reject(() => FileOrphanWire.Witnesses(new(reservation, duplicate.RootElement, null)));
            var peers = Enumerable.Range(1, 5).Select(p => new FileMainWitness(p, "1000", "10")).ToArray();
            var element = System.Text.Json.JsonSerializer.SerializeToElement(peers);
            Reject(() => FileOrphanWire.Witnesses(new(reservation, element, null)));
        });
    }
    private static void Reject(Action action) { bool rejected = false; try { action(); } catch { rejected = true; } Check(rejected); }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("check-failed"); }
}
