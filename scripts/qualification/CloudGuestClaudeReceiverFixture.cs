using System;
using System.Collections.Generic;
using System.Reflection;
internal static class CloudGuestClaudeReceiverFixture
{
    private static int passed;
    private static void Need(bool value) { if (!value) throw new Exception("claude-pure-control-failed"); passed++; }
    private static bool Refused(Action action) { try { action(); return false; } catch { return true; } }
    public static void Main()
    {
        string ready = "{\"schemaVersion\":1,\"kind\":\"claude-ready\",\"address\":\"127.0.0.1\",\"port\":1234,\"nonce\":\"" + new string('a', 32) + "\"}";
        Need(CloudGuestClaudeReceiver.ReadyFrame(ready) == ready);
        foreach (string input in new string[] { ready.Replace("1234", "0"), ready.Replace("1234", "65536"), ready.Replace("1234", "01234"), ready.Replace("127.0.0.1", "0.0.0.0"), ready.Replace("1234", "\"1234\""), ready.Replace("1,\"kind", "1,\"schemaVersion\":1,\"kind"), ready + "\n", new string('a', 257) })
            Need(Refused(() => CloudGuestClaudeReceiver.ReadyFrame(input)));
        string final = "{\"schemaVersion\":1,\"kind\":\"claude-receiver\",\"passed\":true,\"closed\":true,\"stopObserved\":true,\"expired\":false,\"requests\":4,\"completedResponses\":4,\"toolResults\":[true,true,true],\"steps\":[\"read\",\"edit\",\"test\",\"finish\"],\"connectionCount\":2,\"connectionClosed\":2,\"clientEofCount\":2,\"forcedClosed\":0,\"elapsedMilliseconds\":12345,\"failure\":null}";
        CloudGuestClaudeReceiver.FinalFrame(final); Need(true);
        foreach (string input in new string[] { final.Replace("\"passed\":true", "\"passed\":false"), final.Replace("\"expired\":false", "\"expired\":true"), final.Replace("\"requests\":4", "\"requests\":3"), final.Replace("\"connectionClosed\":2", "\"connectionClosed\":1"), final.Replace("\"clientEofCount\":2", "\"clientEofCount\":0"), final.Replace("\"forcedClosed\":0", "\"forcedClosed\":1"), final.Replace("12345", "45000"), final.Replace("\"connectionCount\":2", "\"connectionCount\":02"), final.Replace("null", "\"secret\""), final.Replace("true,true,true", "true,false,true"), final.Replace("\"read\",\"edit\"", "\"edit\",\"read\"") })
            Need(Refused(() => CloudGuestClaudeReceiver.FinalFrame(input)));
        CloudGuestClaudeReceiver.StopFence(42499, 43499, 44999); Need(true);
        Need(Refused(() => CloudGuestClaudeReceiver.StopFence(42500, 42500, 43000)));
        Need(Refused(() => CloudGuestClaudeReceiver.StopFence(42499, 43500, 44000)));
        Need(Refused(() => CloudGuestClaudeReceiver.StopFence(40000, 41000, 45000)));
        Need(Refused(() => CloudGuestClaudeReceiver.StopFence(41000, 40000, 42000)));
        MethodInfo complete = typeof(CloudGuestProcess).GetMethod("CompleteClaudeReceipt", BindingFlags.Static | BindingFlags.NonPublic);
        var facts = new Dictionary<string, object>();
        foreach (string name in new string[] { "runtimeResumed", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "taskReleased", "claudeReceiverStartedAfterRuntimeReady", "claudeReceiverExitObserved", "claudeReceiverStoppedAfterJobClosure", "claudeReceiverResultWritten", "ownerNodeVersionPassed", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopHandlesClosedAfterJobClosure" }) facts[name] = true;
        var value = (Dictionary<string, object>)complete.Invoke(null, new object[] { facts, (uint)0, true, true, null, null });
        Need((bool)value["passed"] && !(bool)value["acceptancePassed"] && (string)value["trustedTestProcessObservation"] == "unknown");
        Need(Refused(() => complete.Invoke(null, new object[] { facts, (uint)7, true, true, null, null })));
        Need(Refused(() => complete.Invoke(null, new object[] { facts, (uint)0, true, false, null, null })));
        facts["runtimeCallerAuthenticated"] = "true";
        Need(Refused(() => complete.Invoke(null, new object[] { facts, (uint)0, true, true, null, null })));
        Console.WriteLine("claude-native-pure-controls:" + passed);
    }
}
