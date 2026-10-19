namespace Aegis.EtwLifecycle;

internal static class FileIssuerTests
{
    private sealed class Pin(uint pid) : IFileIssuerPin
    {
        public uint Pid => pid;
        internal bool Running = true, Disposed;
        internal ulong Witness = 134000000000001111;
        internal int Queries;
        public bool Alive() => Running;
        public ulong Birth() { Queries++; return Witness; }
        public void Dispose() => Disposed = true;
    }
    internal static void Run(Action<string, Action> test)
    {
        FileObservation Read(long qpc, uint tid = 73) => new("1", FileCapture.Provider.ToString(), 15, 1,
            qpc.ToString(), 4, 99, tid, null, @"C:\fixture\a", "candidate-object");
        void Check(bool value) { if (!value) throw new InvalidOperationException("issuer-proof"); }
        test("a detected full-witness owner can prepare its first scoped worker read", () =>
        {
            long now = 100; var worker = new Pin(71);
            using var owner = new FileGeneration(_ => worker, () => now, 1000, 8, _ => [73u]);
            var result = owner.Prepare(new("prepare1", [new(71, worker.Witness.ToString())]));
            Check(result.prepared.Length == 1 && result.prepared[0].threads == 1 && worker.Queries == 1);
            now = 120; var value = owner.Observe(Read(110));
            Check(value.issuerStatus == "verified" && value.issuerPid == 71 && worker.Queries == 2);
        });
        test("preparation cannot certify events preceding its held worker interval", () =>
        {
            long now = 100; var worker = new Pin(71);
            using var owner = new FileGeneration(_ => worker, () => now, 1000, 8, _ => [73u]);
            owner.Prepare(new("prepare1", [new(71, worker.Witness.ToString())])); now = 120;
            Check(owner.Observe(Read(90)).issuerStatus != "verified");
        });
        test("preparation rejects denied handles, another owner and a different full birth", () =>
        {
            foreach (var worker in new Pin?[] { null, new(88), new(71) { Witness = 134000000000001112 } })
            {
                using var owner = new FileGeneration(_ => worker, () => 100, 1000, 8, _ => [73u]);
                var result = owner.Prepare(new("prepare1", [new(71, "134000000000001111")]));
                Check(result.prepared.Length == 0 && owner.Count == 0 && (worker == null || worker.Disposed));
            }
        });
        test("preparation refresh cannot borrow an exited process generation", () =>
        {
            long now = 100; var old = new Pin(71); var fresh = new Pin(71) { Witness = old.Witness + 1 }; int opens = 0;
            using var owner = new FileGeneration(_ => ++opens == 1 ? old : fresh, () => now, 1000, 8, _ => [73u]);
            owner.Prepare(new("prepare1", [new(71, old.Witness.ToString())])); old.Running = false; now = 120;
            Check(owner.Prepare(new("prepare2", [new(71, old.Witness.ToString())])).prepared.Length == 0);
            Check(old.Disposed && fresh.Disposed && owner.Count == 0);
        });
        test("preparation deduplicates inventory and respects capacity and expiry", () =>
        {
            long now = 100; var opened = new List<Pin>();
            using var owner = new FileGeneration(_ => { var pin = new Pin(71); opened.Add(pin); return pin; },
                () => now, 10, 2, _ => [73u, 73u, 74u, 75u]);
            var request = new FileIssuerRequest("prepare1", [new(71, "134000000000001111")]);
            var result = owner.Prepare(request);
            Check(owner.Count == 1 && opened.Count == 1 && result.prepared[0].threads == 1);
            now = 111; owner.Prepare(request);
            Check(opened[0].Disposed && owner.Observe(Read(105)).issuerStatus != "verified");
        });
        test("queued first read keeps the continuously held interval across issuer renewal", () =>
        {
            long now = 100; var opened = new List<Pin>();
            using var owner = new FileGeneration(_ => { var pin = new Pin(71); opened.Add(pin); return pin; },
                () => now, 10, 8, _ => [73u]);
            var request = new FileIssuerRequest("prepare1", [new(71, "134000000000001111")]);
            owner.Prepare(request); now = 106; owner.Prepare(request);
            now = 110; var queued = owner.Observe(Read(105));
            Check(queued.issuerStatus == "verified" && queued.issuerPid == 71);
            Check(opened.Count == 1 && !opened[0].Disposed && owner.Count == 1);
            Check(System.Text.Json.JsonSerializer.SerializeToElement(queued.issuerInterval).GetProperty("fromQpc").GetString() == "100");
        });
        test("an expired original handle cannot backfill its replacement interval", () =>
        {
            long now = 100; var opened = new List<Pin>();
            using var owner = new FileGeneration(_ => { var pin = new Pin(71); opened.Add(pin); return pin; },
                () => now, 10, 8, _ => [73u]);
            var request = new FileIssuerRequest("prepare1", [new(71, "134000000000001111")]);
            owner.Prepare(request); now = 111; owner.Prepare(request);
            Check(opened.Count == 2 && opened[0].Disposed && owner.Count == 1);
            now = 120; Check(owner.Observe(Read(105)).issuerStatus != "verified");
            Check(owner.Observe(Read(112)).issuerStatus == "verified");
        });
        test("renewal still expires after a missing target refresh", () =>
        {
            long now = 100; var opened = new List<Pin>();
            using var owner = new FileGeneration(_ => { var pin = new Pin(71); opened.Add(pin); return pin; },
                () => now, 10, 8, _ => [73u]);
            var request = new FileIssuerRequest("prepare1", [new(71, "134000000000001111")]);
            owner.Prepare(request); now = 106; owner.Prepare(request);
            now = 117; Check(owner.Observe(Read(110)).issuerStatus != "verified");
            Check(opened.Count == 2 && opened[0].Disposed && owner.Count == 1);
        });
        test("new workers at capacity cannot starve renewal of an existing worker", () =>
        {
            long now = 100;
            using var owner = new FileGeneration(tid => new Pin(tid == 99 ? 88u : 71u), () => now, 10, 2,
                pid => pid == 88 ? [99u] : now == 100 ? [73u] : [74u, 73u]);
            owner.Prepare(new("prepare1", [new(71, "134000000000001111"), new(88, "134000000000001111")]));
            Check(owner.Count == 2); now = 106;
            var result = owner.Prepare(new("prepare2", [new(71, "134000000000001111")]));
            Check(result.prepared.Length == 1 && result.prepared[0].threads == 1 && owner.Count == 2);
            now = 111; Check(owner.Observe(Read(105)).issuerStatus == "verified" && owner.Count <= 2);
        });
        test("repeated renewal bounds handles and never caches the process birth", () =>
        {
            long now = 100; int opens = 0; var pin = new Pin(71);
            using var owner = new FileGeneration(_ => { opens++; return pin; }, () => now, 10, 8, _ => [73u]);
            var request = new FileIssuerRequest("prepare1", [new(71, pin.Witness.ToString())]);
            owner.Prepare(request);
            for (int i = 0; i < 1000; i++) { now += 6; owner.Prepare(request); }
            now++; var value = owner.Observe(Read(now - 1));
            Check(value.issuerStatus == "verified" && opens == 1 && owner.Count == 1 && !pin.Disposed);
            Check(pin.Queries == 1002);
            pin.Witness++; now++;
            Check(owner.Observe(Read(now - 1)).generationWitness == pin.Witness.ToString() && pin.Queries == 1003);
        });
        test("preparation leaves native capacity for directly observed scoped issuers", () =>
        {
            long now = 100;
            using var owner = new FileGeneration(_ => new Pin(71), () => now, 1000, 128,
                _ => Enumerable.Range(1, 128).Select(value => (uint)value));
            var result = owner.Prepare(new("prepare1", [new(71, "134000000000001111")]));
            Check(owner.Count == 64 && result.prepared[0].threads == 64);
            Check(owner.Observe(Read(90, 200)).issuerStatus != "verified" && owner.Count > 64);
            now = 120; Check(owner.Observe(Read(110, 200)).issuerStatus == "verified");
        });
        test("late thread lookup cannot prove the preceding event", () =>
        {
            long now = 100; var pin = new Pin(71);
            using var owner = new FileGeneration(_ => pin, () => now, 1000);
            Check(owner.Observe(Read(90)).issuerStatus != "verified"); now = 120;
            var value = owner.Observe(Read(110));
            Check(value.issuerStatus == "verified" && value.issuerPid == 71 && value.headerPid == 4);
            Check(value.generationWitness == pin.Witness.ToString() && value.generationStatus == "verified");
        });
        test("PID and TID reuse cannot borrow the old held object", () =>
        {
            long now = 100; var old = new Pin(71); var fresh = new Pin(71); int opens = 0;
            using var owner = new FileGeneration(_ => ++opens == 1 ? old : fresh, () => now, 1000);
            owner.Observe(Read(90)); old.Running = false; now = 200;
            Check(owner.Observe(Read(110)).issuerStatus != "verified" && old.Disposed); now = 220;
            Check(owner.Observe(Read(210)).issuerStatus == "verified");
        });
        test("existing worker threads are pinned for future scoped reads only", () =>
        {
            long now = 100; int snapshots = 0;
            var pins = new Dictionary<uint, Pin>();
            using var owner = new FileGeneration(tid => pins[tid] = new Pin(tid == 99 ? 88u : 71u),
                () => now, 1000, 8, _ => { snapshots++; return [73u, 74u, 99u]; });
            Check(owner.Observe(Read(90)).issuerStatus != "verified");
            Check(owner.Count == 2 && snapshots == 1 && pins[99].Disposed);
            Check(owner.Observe(Read(90, 74)).issuerStatus != "verified");
            now = 120; var future = owner.Observe(Read(110, 74));
            Check(future.issuerStatus == "verified" && future.issuerPid == 71 && pins[74].Queries == 1);
            pins[74].Running = false; now = 140;
            Check(owner.Observe(Read(130, 74)).issuerStatus != "verified");
        });
        test("worker priming obeys pin capacity and requires a scoped path", () =>
        {
            long now = 100; int snapshots = 0, opens = 0;
            using var owner = new FileGeneration(_ => { opens++; return new Pin(71); }, () => now, 1000, 2,
                _ => { snapshots++; return [74u, 75u, 76u]; });
            owner.Observe(Read(90) with { path = null, pathEvidence = "unresolved" });
            Check(snapshots == 0 && opens == 0);
            now = 120; owner.Observe(Read(110));
            Check(owner.Count == 2 && snapshots == 1 && opens == 2);
        });
        test("creation time is queried on the stamping pass and never cached", () =>
        {
            long now = 100; var pin = new Pin(71);
            using var owner = new FileGeneration(_ => pin, () => now, 1000);
            owner.Observe(Read(90)); now = 120;
            var first = owner.Observe(Read(110)); pin.Witness++; now = 140;
            var second = owner.Observe(Read(130));
            Check(pin.Queries == 2 && first.generationWitness != second.generationWitness);
        });
        test("future events and denied handles remain unresolved", () =>
        {
            long now = 100;
            using var denied = new FileGeneration(_ => null, () => now, 1000);
            Check(denied.Observe(Read(90)).issuerStatus != "verified");
            using var owner = new FileGeneration(_ => new Pin(71), () => now, 1000);
            owner.Observe(Read(90)); Check(owner.Observe(Read(200)).issuerStatus != "verified");
        });
        test("pin capacity and expiry close handles without inventing proof", () =>
        {
            long now = 100; var pins = new List<Pin>();
            using var owner = new FileGeneration(_ => { var p = new Pin(71); pins.Add(p); return p; }, () => now, 10, 2);
            owner.Observe(Read(90, 1)); owner.Observe(Read(90, 2)); owner.Observe(Read(90, 3));
            Check(owner.Count == 2 && pins.Count == 2); now = 111;
            Check(owner.Observe(Read(105, 3)).issuerStatus != "verified");
            Check(pins[0].Disposed && pins[1].Disposed && owner.Count == 1);
        });
    }
}
