namespace Aegis.EtwProbe;

internal sealed record RunSpec(string Name, string Workload, int Seconds, int BuffersMb, int PhaseSeconds = 60);

internal static class StudyPlan
{
    internal static List<RunSpec> Create(string profile, bool simulation)
    {
        var runs = new List<RunSpec>();
        if (profile == "load")
        {
            string[] kinds = ["idle", "npm", "build"];
            for (int repeat = 0; repeat < (simulation ? 1 : 3); repeat++)
                for (int slot = 0; slot < 3; slot++)
                {
                    string kind = kinds[(slot + repeat) % 3];
                    runs.Add(new($"r{repeat + 1}-{kind}", kind, simulation ? 1 : 15, 64));
                }
            if (simulation) runs.Add(new("after-build", "idle", 1, 64));
        }
        else if (profile == "tune")
        {
            int[] buffers = [64, 32, 16];
            for (int repeat = 0; repeat < 3; repeat++)
                for (int slot = 0; slot < 3; slot++)
                {
                    int size = buffers[(slot + repeat) % 3];
                    runs.Add(new($"r{repeat + 1}-b{size}", "npm", simulation ? 1 : 15, size));
                }
            // A fixed stress candidate, not an automatic declaration that 16 MiB is sufficient.
            runs.Add(new("soak-b16", "cycle", simulation ? 6 : 600, 16, simulation ? 1 : 60));
            if (simulation) runs.Add(new("after-build", "idle", 1, 16));
        }
        else throw new ArgumentException("Unknown study profile");
        return runs;
    }

    internal static string WorkloadAt(RunSpec run, double elapsedSeconds) => run.Workload == "cycle"
        ? new[] { "idle", "npm", "build" }[(int)(elapsedSeconds / run.PhaseSeconds) % 3] : run.Workload;
}
