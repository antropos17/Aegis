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
