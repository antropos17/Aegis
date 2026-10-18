namespace Aegis.EtwLifecycle;

internal static class FileGuardTests
{
    internal static void Run(Action<string, Action> test)
    {
        var guid = Guid.NewGuid();
        var token = new FileTraceToken("123", guid.ToString("N"));
        FileStats Stats(uint status) => new(status, status == 0 ? 7u : null, status == 0 ? 0u : null,
            status == 0 ? 0u : null, null, null);
        void Check(bool value) { if (!value) throw new InvalidOperationException("guard-proof"); }
        test("recovery uses the original handle and preserves final native loss", () =>
        {
            int calls = 0;
            var r = FileTrace.Recover(token, code =>
            {
                calls++;
                Check(code == (calls == 2 ? 1u : 0u));
                return (Stats(calls == 3 ? 4201u : 0u), guid);
            });
            Check(r.stopped && r.absent && r.counters?.Events == 7 && calls == 3);
        });
        test("foreign session GUID never grants stop authority", () =>
        {
            int calls = 0;
            var r = FileTrace.Recover(token, code => { calls++; Check(code == 0); return (Stats(0), Guid.NewGuid()); });
            Check(!r.stopped && !r.absent && calls == 1);
        });
        test("query and stop failures never become a cleanup receipt", () =>
        {
            foreach (bool failStop in new[] { false, true })
            {
                var r = FileTrace.Recover(token, code => (Stats(failStop ? (code == 1 ? 5u : 0u) : 5u), guid));
                Check(!r.stopped && !r.absent);
            }
        });
        test("already absent does not invent zero counters", () =>
        {
            var r = FileTrace.Recover(token, code => (Stats(4201), Guid.Empty));
            Check(r.stopped && r.absent && r.counters?.Events == null && r.counters?.Status == 4201);
        });
        test("successful stop still requires an independent absence query", () =>
        {
            var r = FileTrace.Recover(token, code => (Stats(0), guid));
            Check(r.stopped && !r.absent && r.kind == "unverified");
        });
        test("private guard framing rejects oversize before reading the payload", () =>
        {
            using var bytes = new MemoryStream(new byte[] { 1, 8, 0, 0 });
            bool rejected = false;
            try { FileGuardWire.Read<FileGuardCommand>(bytes, CancellationToken.None).GetAwaiter().GetResult(); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected);
        });
    }
}
