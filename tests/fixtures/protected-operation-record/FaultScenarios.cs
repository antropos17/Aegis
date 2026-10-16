#if PROTECTED_OPERATION_TEST
using System;
using Aegis.ProtectedSession;

internal static partial class ProtectedOperationFixture
{
    private static int Fault(string mode)
    {
        var parts = mode.Split(new[] { ':' }, 2); string stage = parts[0], fault = parts[1];
        var store = new FixtureStore(); var state = ProtectedOperationState.CreateForTest(Binding(), store); int effects = 0;
        string digest = state.RecordIntentForTest(Intent(OperationId)).OperationSha256;
        if (stage != "consume") state.ConsumeForTest(OperationId);
        FixtureDispatchDecision decision = null;
        if (stage == "settle") decision = state.DispatchForTest(OperationId, delegate { effects++; return true; });
        store.FailAt = store.Commits + 1; store.Fault = fault;
        Action work = delegate
        {
            if (stage == "consume") state.ConsumeForTest(OperationId);
            else if (stage == "dispatch") state.DispatchForTest(OperationId, delegate { effects++; return true; });
            else state.SettleForTest(decision.Acknowledgment);
        };
        if (fault == "short-progress")
        {
            work(); Check(store.PartialWrites > 1 && effects == 0); state.DispatchForTest(OperationId, delegate { effects++; return true; });
            Check(effects == 1); return effects;
        }
        Check(Refuses(work)); Check(effects == (stage == "settle" ? 1 : 0));
        Check(state.Inspect(OperationId, digest).Unavailable);
        store.Fault = null;
        Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
        Check(effects == (stage == "settle" ? 1 : 0)); return effects;
    }
    private static int Crash(string mode)
    {
        var store = new FixtureStore(); var state = ProtectedOperationState.CreateForTest(Binding(), store); int effects = 0;
        var intent = Intent(OperationId);
        string digest = ProtectedOperationRecord.CreateForTest(Binding(), intent, ProtectedOperationPhase.RecordedIntent, 1, ProtectedOperationRecord.ZeroHash).OperationSha256;
        var parts = mode.Split('-'); int stage;
        if (Int32.TryParse(parts[0], out stage))
        {
            store.FailAt = stage; store.Fault = parts[1] == "before" ? "throw-before" : "throw-after";
            Check(Refuses(delegate
            {
                state.RecordIntentForTest(intent); state.ConsumeForTest(OperationId);
                var result = state.DispatchForTest(OperationId, delegate { effects++; return true; });
                state.SettleForTest(result.Acknowledgment);
            }));
            Check(effects == (stage == 4 ? 1 : 0));
        }
        else
        {
            state.RecordIntentForTest(intent);
            if (mode != "intent-ack")
            {
                state.ConsumeForTest(OperationId);
                if (mode != "consume-ack")
                {
                    var result = state.DispatchForTest(OperationId, delegate
                    {
                        if (mode == "marker-before-effect") throw new Exception("fixture-pre-effect");
                        effects++; if (mode == "during-effect") throw new Exception("fixture-unknown"); return true;
                    });
                    if (mode == "terminal-ack") state.SettleForTest(result.Acknowledgment);
                }
            }
        }
        var replay = ProtectedOperationState.Replay(Binding(), store.Snapshot());
        Check(replay.ReplayStatus == "PrefixOnly");
        var observation = replay.Inspect(OperationId, digest);
        Check(observation.Unknown == (observation.Phase == ProtectedOperationPhase.DurablyConsumed || observation.Phase == ProtectedOperationPhase.DispatchedUnknown));
        if (store.Frames.Count == 2 || store.Frames.Count == 3) Check(observation.Unknown);
        Check(Refuses(delegate { replay.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
        Check(effects <= 1); return effects;
    }
}
#endif
