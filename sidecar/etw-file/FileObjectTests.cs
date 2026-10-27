namespace Aegis.EtwLifecycle;

internal static class FileObjectTests
{
    private sealed class Pin : IFileObjectPin
    {
        internal bool Running = true, Disposed;
        internal ulong Witness = 134000000000001111;
        internal FileObjectLabel? Label = new(42, "00112233445566778899aabbccddeeff", @"C:\fixture\secret.env");
        public bool Alive() => Running && !Disposed;
        public ulong Birth() => Witness;
        public FileObjectLabel? Inspect() => Label;
        public void Dispose() => Disposed = true;
    }
    internal static void Run(Action<string, Action> test)
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("object-proof"); }
        FileObservation Read(long time, string birth = "134000000000001111") => new("1", FileCapture.Provider.ToString(),
            15, 1, time.ToString(), 4, 99, 73, null, @"C:\fixture\secret.env", "candidate-object",
            "verified", "verified", birth, "createTime100ns", new { fromQpc = time, toQpc = time },
            issuerPid: 71, issuerInterval: new { fromQpc = 1, toQpc = time });
        FileScope Scope() => new(@"C:\fixture", false);
        test("documented object comparison distinguishes duplicates from independent opens", () =>
        {
            bool passed = FileObjectNative.DocumentedHandleProbe(out var code);
            if (!passed) Console.WriteLine("OBJECT_PROBE " + code);
            Check(passed && code == FileObjectProbeCode.Qualified);
        });
        test("actual object lease never backfills its discovering or queued earlier read", () =>
        {
            long now = 100; var pin = new Pin();
            using var owner = new FileObjectLease(Scope(), (_, _, _) => pin, () => now, () => 2000, 1000);
            Check(owner.Observe(Read(90), 42) == null && owner.Count == 1);
            now = 105;
            Check(owner.Observe(Read(104), 42) == null);
            Check(owner.Bind(new("bind-1", "1", "scope-1", "policy-1")).accepted);
            now = 120; Check(owner.Observe(Read(99), 42) == null && owner.Observe(Read(100), 42) == null);
            Check(owner.Observe(Read(105), 42) == null);
            var proof = owner.Observe(Read(110), 42);
            Check(proof?.source == "issuer-handle-file-id" && proof.fromQpc == "105" && proof.toQpc == "120" &&
                proof.labelSemantics == "pre-read-object-binding" && proof.path == @"C:\fixture\secret.env");
        });
        test("object lease rejects unrelated objects and same-millisecond process reuse", () =>
        {
            long now = 100; var pin = new Pin(); int opens = 0;
            using var owner = new FileObjectLease(Scope(), (_, birth, obj) =>
            { opens++; return birth == pin.Witness && obj == 42 ? pin : null; }, () => now, () => 2000, 1000);
            owner.Observe(Read(90), 42); now = 1120;
            Check(owner.Observe(Read(110), 43) == null);
            now = 2120;
            Check(owner.Observe(Read(110, "134000000000001112"), 42) == null && opens == 3);
        });
        test("expired, exited and invalidated object leases never preserve authority", () =>
        {
            foreach (string failure in new[] { "expired", "exited", "reset" })
            {
                long now = 100; var pin = new Pin();
                int opens = 0;
                using var owner = new FileObjectLease(Scope(), (_, _, _) => { opens++; return opens == 1 ? pin : new Pin(); },
                    () => now, () => 2000, 1000, 10);
                owner.Observe(Read(90), 42);
                now = 101; owner.Bind(new("bind-1", "1", "scope-1", "policy-1"));
                if (failure == "expired") now = 111;
                else if (failure == "exited") { now = 105; pin.Running = false; }
                else { now = 105; owner.Dispose(); }
                Check(owner.Observe(Read(104), 42) == null);
                if (failure == "reset") { now = 3000; Check(owner.Observe(Read(2999), 42) == null && opens == 1); }
            }
        });
        test("identity replacement, scope departure and label changes revoke retained objects", () =>
        {
            foreach (var replacement in new[] {
                new FileObjectLabel(43, "00112233445566778899aabbccddeeff", @"C:\fixture\secret.env"),
                new FileObjectLabel(42, "10112233445566778899aabbccddeeff", @"C:\fixture\secret.env"),
                new FileObjectLabel(42, "00112233445566778899aabbccddeeff", @"C:\outside\secret.env"),
                new FileObjectLabel(42, "00112233445566778899aabbccddeeff", @"C:\fixture\renamed.env") })
            {
                long now = 100; var pin = new Pin();
                using var owner = new FileObjectLease(Scope(), (_, _, _) => pin, () => now, () => 2000, 1000);
                owner.Observe(Read(90), 42); now = 101; owner.Bind(new("bind-1", "1", "scope-1", "policy-1"));
                pin.Label = replacement; now = 120;
                Check(owner.Observe(Read(110), 42) == null && pin.Disposed && owner.Count == 0);
            }
        });
        test("object handle inventory is bounded and denial creates no lease", () =>
        {
            long now = 100; var pins = new List<Pin>();
            using var owner = new FileObjectLease(Scope(), (_, _, obj) =>
            { if (obj == 0) return null; var pin = new Pin(); pins.Add(pin); return pin; },
                () => now, () => 2000, 1000, cap: 2);
            owner.Observe(Read(90), 42); now = 1100; owner.Observe(Read(1090), 43);
            now = 2100; owner.Observe(Read(2090), 44);
            Check(owner.Count == 2 && pins.Count == 2);
            owner.Dispose(); Check(pins.All(pin => pin.Disposed));
        });
        test("idle sweep closes expired handles without another read", () =>
        {
            long now = 100; var pin = new Pin();
            using var owner = new FileObjectLease(Scope(), (_, _, _) => pin, () => now, () => 2000, 1000, 10);
            owner.Observe(Read(90), 42); now = 111; owner.Sweep();
            Check(pin.Disposed && owner.Count == 0);
        });
        test("default production factory and denied qualification cannot create authority", () =>
        {
            using var ordinary = new FileObjectLease(Scope(), timestamp: () => 100);
            Check(ordinary.Observe(Read(90), 42) == null && ordinary.Count == 0);
            using var denied = new FileObjectLease(Scope(), (_, _, _) => null, () => 100);
            Check(denied.Observe(Read(90), 42) == null && denied.Count == 0);
        });
        test("reset cannot reuse an opaque binding ID for another object", () =>
        {
            long now = 100;
            using var owner = new FileObjectLease(Scope(), (_, _, _) => new Pin(), () => now, () => 2000, 1000);
            owner.Observe(Read(90), 42); owner.Reset(); now = 1200; owner.Observe(Read(1190), 43);
            Check(!owner.Bind(new("old", "1", "scope-1", "policy-1")).accepted);
            Check(owner.Bind(new("new", "2", "scope-1", "policy-1")).accepted);
        });
        test("policy ACK rejects a replacement or changed process generation", () =>
        {
            foreach (bool changeBirth in new[] { false, true })
            {
                long now = 100; var pin = new Pin();
                using var owner = new FileObjectLease(Scope(), (_, _, _) => pin, () => now, () => 2000, 1000);
                owner.Observe(Read(90), 42);
                if (changeBirth) pin.Witness++;
                else pin.Label = pin.Label! with { Id = "10112233445566778899aabbccddeeff" };
                now = 105;
                Check(!owner.Bind(new("bind", "1", "scope", "policy")).accepted && pin.Disposed);
            }
        });
        test("private kernel addresses never enter serialized observations", () =>
        {
            string json = System.Text.Json.JsonSerializer.Serialize(Read(100) with { NativeObject = 0x1111222233334444 });
            using var value = System.Text.Json.JsonDocument.Parse(json);
            Check(!value.RootElement.TryGetProperty("NativeObject", out _) &&
                !value.RootElement.TryGetProperty("objectProof", out _));
        });
    }
}
