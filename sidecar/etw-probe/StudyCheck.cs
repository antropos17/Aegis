using System.Text.Json;

namespace Aegis.EtwProbe;

internal static class StudyCheck
{
    private static JsonElement Read(string directory, string file)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, file)));
        return json.RootElement.Clone();
    }

    private static void Require(bool value)
    {
        if (!value) throw new InvalidOperationException("Study protocol assertion failed");
    }

    // Real npm and renderer build, simulated collector: no UAC or ETW session.
    // An extra idle run after build catches contamination of the next capture.
    internal static void Verify(string directory)
    {
        var study = Read(directory, "study.json");
        Require(study.GetProperty("simulation").GetBoolean());
        var matrix = Read(directory, "matrix.json");
        Require(matrix.GetArrayLength() == study.GetProperty("plan").GetArrayLength());
        long previousEnd = 0;
        foreach (var row in matrix.EnumerateArray())
        {
            Require(row.GetProperty("exitCode").GetInt32() == 0);
            string run = Path.Combine(directory, row.GetProperty("name").GetString()!);
            var workload = Read(run, "workload.json");
            long ready = Read(run, "capture-ready.json").GetProperty("qpc").GetInt64();
            long stopped = Read(run, "capture-stopped.json").GetProperty("qpc").GetInt64();
            Require(ready >= previousEnd && stopped > ready);
            Require(workload.GetProperty("simulation").GetBoolean() && !workload.GetProperty("elevated").GetBoolean());
            Require(workload.GetProperty("beginQpc").GetInt64() >= ready);
            bool idle = workload.GetProperty("Workload").GetString() == "idle";
            int count = workload.GetProperty("completedCommands").GetInt32();
            Require(idle ? count == 0 : count > 0);
            foreach (var command in workload.GetProperty("commands").EnumerateArray())
                Require(command.GetProperty("exitCode").GetInt32() == 0);
            previousEnd = workload.GetProperty("endQpc").GetInt64();
            Require(previousEnd >= stopped);
            Require(File.Exists(Path.Combine(run, "workload-done.json")) && !File.Exists(Path.Combine(run, "summary.json")));
        }
        Console.WriteLine("PASS study protocol: real workloads, normal token, capture boundaries and post-build isolation");
    }
}
