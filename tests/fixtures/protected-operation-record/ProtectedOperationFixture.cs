using System;
using System.Linq;
using System.Reflection;
using System.Text;
using Aegis.ProtectedSession;

internal static partial class ProtectedOperationFixture
{
    internal static readonly Guid OperationId = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    internal static ProtectedOperationBinding Binding(string changed = "")
    {
        return new ProtectedOperationBinding(new string(changed == "install" ? 'b' : 'a', 32), changed == "revision" ? 2u : 1u,
            new string(changed == "epoch" ? 'b' : 'c', 32), new string(changed == "policy" ? 'b' : 'd', 64),
            new string(changed == "selection" ? 'b' : 'e', 32), new string(changed == "selectionEpoch" ? 'b' : 'f', 32),
            Guid.Parse(changed == "vm" ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111"),
            new string(changed == "identity" ? 'b' : '1', 64), VmConfigurationProfile.Name,
            new string(changed == "configuration" ? 'b' : '2', 64), new string(changed == "session" ? 'b' : '3', 32),
            new string(changed == "sessionEpoch" ? 'b' : '4', 32));
    }
    internal static VmOperationRecord Intent(Guid id, ushort requested = 2)
    { return new VmOperationRecord(id, Binding().VmId, requested, null, null, true); }
    internal static void Check(bool value) { if (!value) throw new Exception("fixture-contract-failed"); }
    internal static bool Refuses(Action action)
    { try { action(); return false; } catch (Exception) { return true; } }
    private static void Production()
    {
        Assembly assembly = typeof(ProtectedOperationState).Assembly;
        Check(assembly.GetTypes().All(type => !type.Name.StartsWith("Fixture", StringComparison.Ordinal) &&
            type.Name != "IProtectedOperationFixtureStore"));
        foreach (Type type in new[] { typeof(ProtectedOperationState), typeof(ProtectedOperationRecord) })
            Check(type.GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .All(method => !method.Name.Contains("ForTest") && !method.Name.Contains("Dispatch") && !method.Name.Contains("Commit")));
        Check(ProtectedOperationState.Replay(Binding(), new byte[0][]).ReplayStatus == "PrefixOnly");
        Console.WriteLine("{\"passed\":true,\"productionInert\":true,\"effects\":0}");
    }
    public static int Main(string[] args)
    {
        try
        {
            if (args[0] == "production") { Production(); return 0; }
            if (args[0] == "parse" || args[0] == "replay")
            {
                try
                {
                    if (args[0] == "parse")
                    {
                        var record = ProtectedOperationRecord.Parse(Convert.FromBase64String(args[1]));
                        Console.WriteLine("{\"accepted\":true,\"phase\":\"" + record.Phase + "\",\"encoded\":\"" + Convert.ToBase64String(record.Encode()) + "\",\"effects\":0}");
                    }
                    else
                    {
                        var state = ProtectedOperationState.Replay(Binding(), args.Skip(1).Select(Convert.FromBase64String).ToArray());
                        var first = args.Length == 1 ? null : ProtectedOperationRecord.Parse(Convert.FromBase64String(args[1]));
                        var observation = state.Inspect(OperationId, first == null ? null : first.OperationSha256);
                        Console.WriteLine("{\"accepted\":true,\"status\":\"" + state.ReplayStatus + "\",\"sequence\":" + state.Sequence + ",\"revoked\":" +
                            state.Revoked.ToString().ToLowerInvariant() + ",\"unknown\":" + observation.Unknown.ToString().ToLowerInvariant() + ",\"effects\":0}");
                    }
                }
                catch { Console.WriteLine("{\"accepted\":false,\"effects\":0}"); }
                return 0;
            }
#if PROTECTED_OPERATION_TEST
            if (args[0] == "frames") { Frames(args.Length > 1 ? args[1] : ""); return 0; }
            int effects = Scenario(args[0]);
            Console.WriteLine("{\"passed\":true,\"effects\":" + effects + ",\"simulatedStore\":true,\"protectedBackendQualified\":false}");
            return 0;
#else
            throw new Exception("fixture-mode-unavailable");
#endif
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
#if PROTECTED_OPERATION_TEST
    private static void Frames(string changed)
    {
        var binding = Binding(changed); var intent = new VmOperationRecord(OperationId, binding.VmId, 2, null, null, true);
        string head = ProtectedOperationRecord.ZeroHash; var frames = new string[5];
        var phases = new[] { ProtectedOperationPhase.RecordedIntent, ProtectedOperationPhase.DurablyConsumed,
            ProtectedOperationPhase.DispatchedUnknown, ProtectedOperationPhase.SettledSuccess, ProtectedOperationPhase.RevokedAdmission };
        for (int index = 0; index < frames.Length; index++)
        {
            var record = ProtectedOperationRecord.CreateForTest(binding, index == 4 ? null : intent, phases[index], (uint)index + 1, head);
            frames[index] = "\"" + Convert.ToBase64String(record.Encode()) + "\""; head = record.RecordSha256;
        }
        Console.WriteLine("[" + String.Join(",", frames) + "]");
    }
#endif
}
