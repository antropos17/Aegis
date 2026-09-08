using System.Text.Json;

namespace Aegis.EtwProbe;

internal static class SelfTest
{
    internal static int Run()
    {
        int passed = 0;
        void Check(bool condition) { if (!condition) throw new InvalidOperationException("Self-test assertion failed"); }
        void Test(string name, Action action) { action(); passed++; Console.WriteLine("PASS " + name); }
        var root = @"C:\fixture";
        Input Row(int id, string? name = null, string? obj = "100", string? key = "200", int pid = 10) =>
            new(id, 1, 0, pid, 20, 20, null, obj, key, name);
        Observation New(string evict = "close", int samples = 100, int maps = 100) =>
            new(root, @"\Device\Volume\fixture", [10, 11], evict, samples, maps);

        Test("fixture path boundary and device path", () =>
        {
            var obs = New();
            Check(obs.FixtureName(root + @"\target.dat") == "target.dat");
            Check(obs.FixtureName(@"\Device\Volume\fixture\control.dat") == "control.dat");
            Check(obs.FixtureName(root + @"-other\target.dat") == null);
            Check(obs.FixtureName(root + @"\..\secret") == null);
            Check(obs.FixtureName(root + @"\credentials.env") == null);
        });
        Test("fresh name then candidate object correlation", () =>
        {
            var obs = New(); obs.Accept(Row(12, root + @"\target.dat")); obs.Accept(Row(15));
            Check(obs.Samples[1].PathEvidence == "candidate-object" && obs.FixturePathReads == 1);
        });
        Test("preopened read stays unresolved without path evidence", () =>
        {
            var obs = New(); obs.Accept(Row(15));
            Check(obs.UnresolvedActorReads == 1 && obs.Samples[0].FixtureFile == null);
        });
        Test("ETW QPC clock survives sampling", () =>
        {
            var obs = New(); obs.Accept(Row(15) with { Qpc = 987654321 });
            Check(obs.Samples[0].Qpc == 987654321);
        });
        Test("name-create key-only candidate", () =>
        {
            var obs = New(); obs.Accept(Row(10, root + @"\target.dat", obj: null)); obs.Accept(Row(15));
            Check(obs.Samples[1].PathEvidence == "candidate-key");
        });
        Test("outside-fixture pointer reuse invalidates old mapping", () =>
        {
            var obs = New(); obs.Accept(Row(12, root + @"\target.dat"));
            obs.Accept(Row(12, @"C:\private\secret.env", pid: 99)); obs.Accept(Row(15));
            Check(obs.Samples[^1].FixtureFile == null);
            Check(!JsonSerializer.Serialize(obs.Samples).Contains("secret"));
        });
        Test("conflicting object and key never select a path", () =>
        {
            var obs = New(); obs.Accept(Row(12, root + @"\target.dat", key: null));
            obs.Accept(Row(10, root + @"\control.dat", obj: null)); obs.Accept(Row(15));
            Check(obs.PathConflicts == 1 && obs.Samples[^1].PathEvidence == "conflict");
        });
        Test("close eviction", () =>
        {
            var obs = New(); obs.Accept(Row(12, root + @"\target.dat")); obs.Accept(Row(14)); obs.Accept(Row(15));
            Check(obs.Samples[^1].FixtureFile == null);
        });
        Test("cleanup policy is an explicit experimental switch", () =>
        {
            var close = New(); var cleanup = New("cleanup");
            foreach (var obs in new[] { close, cleanup })
            { obs.Accept(Row(12, root + @"\target.dat")); obs.Accept(Row(13)); obs.Accept(Row(15)); }
            Check(close.Samples[^1].FixtureFile != null && cleanup.Samples[^1].FixtureFile == null);
        });
        Test("raw pointer values are not serialized", () =>
        {
            var obs = New(); obs.Accept(Row(15, obj: "1234567890987654321"));
            string json = JsonSerializer.Serialize(obs.Samples);
            Check(!json.Contains("1234567890987654321") && json.Contains("o0"));
        });
        Test("record cap reports omitted records", () =>
        {
            var obs = New(samples: 1); obs.Accept(Row(15)); obs.Accept(Row(15));
            Check(obs.Samples.Count == 1 && obs.OmittedSamples == 1);
        });
        Test("map cap clears evidence and reports the reset", () =>
        {
            var obs = New(maps: 1); obs.Accept(Row(12, root + @"\target.dat")); obs.Accept(Row(15));
            Check(obs.MappingResets == 1 && obs.Samples[^1].FixtureFile == null);
        });
        Test("unrelated payloads leave no output sample", () =>
        {
            var obs = New(); obs.Accept(Row(12, @"C:\private\secret.env", pid: 99));
            Check(obs.Samples.Count == 0);
        });
        Test("explicit filters and bounds", () =>
        {
            var options = Options.Parse(["capture", "unused", "--keywords", "0x190", "--pid-filter", "target", "--events", "15"]);
            Check(options.Keywords == 0x190 && options.PidFilter && options.Events!.SequenceEqual([15]));
            bool rejected = false;
            try { Options.Parse(["capture", "unused", "--seconds", "999"]); } catch (ArgumentException) { rejected = true; }
            Check(rejected);
        });
        Test("native loss-query ABI and unavailable counters", () =>
        {
            Native.CheckLayout();
            var result = Native.QueryLoss("AEGIS-FileProbe-does-not-exist-" + Guid.NewGuid().ToString("N"));
            Check(result.QueryStatus != 0 && result.EventsLost == null && result.RealTimeBuffersLost == null);
        });
        Test("callback thread-owner query is an observation", () =>
            Check(Native.ThreadOwner(Native.GetCurrentThreadId()) == Environment.ProcessId));
        Test("buffer comparisons are balanced and soak is one bounded session", () =>
        {
            var plan = StudyPlan.Create("tune", false);
            Check(plan.Count == 10 && plan.Select(r => r.Name).Distinct().Count() == 10);
            foreach (int size in new[] { 16, 32, 64 })
            {
                Check(plan.Take(9).Count(r => r.BuffersMb == size && r.Workload == "npm" && r.Seconds == 15) == 3);
                Check(plan.Take(9).Select((r, i) => (r, i)).Where(x => x.r.BuffersMb == size).Select(x => x.i % 3).Distinct().Count() == 3);
            }
            var soak = plan[^1];
            Check(soak.Seconds == 600 && soak.BuffersMb == 16);
            Check(StudyPlan.WorkloadAt(soak, 59.9) == "idle" && StudyPlan.WorkloadAt(soak, 60) == "npm" &&
                StudyPlan.WorkloadAt(soak, 120) == "build" && StudyPlan.WorkloadAt(soak, 180) == "idle");
            Check(Options.Parse(["capture", "unused", "--seconds", "600"]).Seconds == 600);
        });
        Test("resource failures and losses remain degraded", () =>
        {
            var row = new ResourceSample(0, 0, 1, 1, 1, 1, 0, new Native.Loss(0, 0, 0, 0, 1, 64), null);
            Check(!row.Degraded && (row with { Loss = null }).Degraded);
            Check((row with { Loss = new Native.Loss(0, 1, 0, 0, 1, 64) }).Degraded);
            Check((row with { ErrorType = "TestFailure" }).Degraded);
        });
        Test("resource sampler stops, reports missing counters and bounded retention", () =>
        {
            async Task Exercise()
            {
                await using var sampler = new ResourceSampler("AEGIS-FileProbe-missing-" + Guid.NewGuid().ToString("N"),
                    TimeSpan.FromMilliseconds(10), limit: 1);
                await Task.Delay(60);
                await sampler.Stop();
                Check(sampler.Samples.Count == 1 && sampler.Samples[0].WorkingSetBytes > 0);
                Check(sampler.Samples[0].Loss?.QueryStatus != 0 && sampler.Degraded && sampler.Omitted > 0);
                int omitted = sampler.Omitted;
                await Task.Delay(30);
                Check(sampler.Omitted == omitted);
            }
            Exercise().GetAwaiter().GetResult();
        });
        Console.WriteLine($"{passed} self-tests passed");
        return 0;
    }
}
