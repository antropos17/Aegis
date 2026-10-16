#if PROTECTED_OPERATION_TEST
using System;
using Aegis.ProtectedSession;

internal static partial class ProtectedOperationFixture
{
    private static int Scenario(string mode)
    {
        if (mode.StartsWith("fault-", StringComparison.Ordinal)) return Fault(mode.Substring(6));
        if (mode.StartsWith("crash-", StringComparison.Ordinal)) return Crash(mode.Substring(6));
        if (mode.StartsWith("race-", StringComparison.Ordinal)) return Race(mode.Substring(5));
        var store = new FixtureStore(); var state = ProtectedOperationState.CreateForTest(Binding(), store);
        int effects = 0; var intent = Intent(OperationId); var recorded = state.RecordIntentForTest(intent);
        string digest = recorded.OperationSha256;
        if (mode == "codec-owned")
        {
            byte[] bytes = store.Frames[0]; var parsed = ProtectedOperationRecord.Parse(bytes); byte[] encoded = parsed.Encode();
            encoded[0] = 0; bytes[0] = 0;
            Check(parsed.Encode()[0] == (byte)'{' && parsed.Intent.RequestedState == 2); return 0;
        }
        if (mode == "changed-replay")
        {
            Check(Refuses(delegate { state.RecordIntentForTest(Intent(OperationId, 3)); }));
            Check(state.Sequence == 1 && store.Commits == 1); return 0;
        }
        if (mode == "dispatch-before-consume")
        {
            Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
            Check(effects == 0 && store.Commits == 1); return effects;
        }
        if (mode == "revoke-intent")
        {
            state.RevokeForTest(); Check(Refuses(delegate { state.ConsumeForTest(OperationId); }));
            Check(state.Revoked && state.Sequence == 2); return 0;
        }
        state.ConsumeForTest(OperationId); Check(effects == 0);
        if (mode == "unresolved" || mode == "revoke-consumed")
        {
            if (mode == "revoke-consumed") state.RevokeForTest();
            Guid other = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
            if (!state.Revoked) state.RecordIntentForTest(Intent(other, 3));
            Check(Refuses(delegate { if (state.Revoked) state.DispatchForTest(OperationId, delegate { effects++; return true; }); else state.ConsumeForTest(other); }));
            var prior = state.Inspect(OperationId, digest); Check(prior.Unknown && prior.Intent.RequestedState == 2);
            var restored = ProtectedOperationState.Replay(Binding(), store.Snapshot());
            Check(restored.Inspect(OperationId, digest).Unknown && restored.ReplayStatus == "PrefixOnly");
            Check(Refuses(delegate { restored.ConsumeForTest(OperationId); })); return 0;
        }
        if (mode == "restored-store" || mode == "revoked-restored")
        {
            byte[][] original = store.Snapshot(); if (mode == "revoked-restored") state.RevokeForTest();
            store.Frames.Clear(); store.Frames.Add(original[0]);
            Check(Refuses(delegate { state.ConsumeForTest(OperationId); }));
            store.Frames.Clear(); store.Frames.AddRange(original);
            Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
            Check(mode != "revoked-restored" || state.Revoked); Check(state.Inspect(OperationId, digest).Unknown); return 0;
        }
        if (mode == "reentry-store")
        {
            store.DuringCommit = delegate { Check(Refuses(delegate { state.ConsumeForTest(OperationId); })); };
            Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
            Check(effects == 0); return effects;
        }
        if (mode == "revoke-failure")
        {
            store.FailAt = 3; store.Fault = "sync"; Check(Refuses(state.RevokeForTest));
            Check(state.Revoked && state.Inspect(OperationId, digest).Unknown);
            store.Frames.RemoveAt(store.Frames.Count - 1); store.Fault = null;
            Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); })); return effects;
        }
        if (mode == "reentry-effect")
        {
            state.DispatchForTest(OperationId, delegate { effects++; state.RevokeForTest(); return true; });
            Check(effects == 1 && state.Revoked && state.Inspect(OperationId, digest).Unknown); return effects;
        }
        if (mode == "capacity") return Capacity(state, store, digest);
        var decision = state.DispatchForTest(OperationId, delegate { effects++; return mode != "settled-failure"; });
        Check(decision.Entered && effects == 1 && state.Inspect(OperationId, digest).Unknown);
        if (mode == "effect-no-settlement")
        {
            Check(ProtectedOperationState.Replay(Binding(), store.Snapshot()).Inspect(OperationId, digest).Unknown); return effects;
        }
        if (mode == "revoke-dispatched") state.RevokeForTest();
        if (mode == "forged-effect")
        {
            var forged = new FixtureEffectAcknowledgment(state, OperationId, digest, true);
            Check(Refuses(delegate { state.SettleForTest(forged); }));
            Check(state.Inspect(OperationId, digest).Unknown); return effects;
        }
        state.SettleForTest(decision.Acknowledgment); uint count = state.Sequence;
        state.SettleForTest(decision.Acknowledgment); state.ConsumeForTest(OperationId); state.RecordIntentForTest(intent);
        Check(!state.DispatchForTest(OperationId, delegate { effects++; return true; }).Entered);
        Check(state.Sequence == count && effects == 1);
        Check(state.Inspect(OperationId, digest).Phase == (mode == "settled-failure" ? ProtectedOperationPhase.SettledFailure : ProtectedOperationPhase.SettledSuccess));
        if (mode == "revoke-dispatched") Check(state.Revoked);
        else Check(mode == "duplicates" || mode == "settled-failure");
        return effects;
    }
    private static int Capacity(ProtectedOperationState state, FixtureStore store, string digest)
    {
        int effects = 0;
        for (int index = 0; index < ProtectedOperationState.MaximumOperations; index++)
        {
            Guid id = index == 0 ? OperationId : new Guid(index, 1, 1, new byte[8]);
            if (index != 0) { state.RecordIntentForTest(Intent(id)); state.ConsumeForTest(id); }
            var decision = state.DispatchForTest(id, delegate { effects++; return true; });
            if (index != ProtectedOperationState.MaximumOperations - 1) state.SettleForTest(decision.Acknowledgment);
            else
            {
                Guid extra = Guid.Parse("ffffffff-ffff-4fff-8fff-ffffffffffff");
                Check(Refuses(delegate { state.RecordIntentForTest(Intent(extra)); }));
                state.RevokeForTest(); state.SettleForTest(decision.Acknowledgment);
            }
        }
        Check(state.Sequence == ProtectedOperationState.MaximumRecords && state.Revoked && effects == 256);
        Check(ProtectedOperationState.Replay(Binding(), store.Snapshot()).Revoked);
        state.RecordIntentForTest(Intent(OperationId)); state.ConsumeForTest(OperationId); state.RevokeForTest();
        Check(state.Sequence == ProtectedOperationState.MaximumRecords && !state.Inspect(OperationId, digest).Unknown);
        return effects;
    }
}
#endif
