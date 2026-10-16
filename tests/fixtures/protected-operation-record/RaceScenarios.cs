#if PROTECTED_OPERATION_TEST
using System;
using System.Threading;
using Aegis.ProtectedSession;

internal static partial class ProtectedOperationFixture
{
    private static int Race(string mode)
    {
        var store = new FixtureStore(); var state = ProtectedOperationState.CreateForTest(Binding(), store); int effects = 0;
        string digest = state.RecordIntentForTest(Intent(OperationId)).OperationSha256; state.ConsumeForTest(OperationId);
        using (var ordered = new ManualResetEvent(false))
        {
            Exception error = null; FixtureDispatchDecision decision = null;
            var first = new Thread(delegate()
            {
                try
                {
                    if (mode == "revoke-first") state.RevokeForTest();
                    else decision = state.DispatchForTest(OperationId, delegate { effects++; ordered.Set(); return true; });
                }
                catch (Exception caught) { error = caught; }
                finally { ordered.Set(); }
            });
            first.Start(); Check(ordered.WaitOne(3000));
            if (mode == "revoke-first") Check(Refuses(delegate { state.DispatchForTest(OperationId, delegate { effects++; return true; }); }));
            else state.RevokeForTest();
            Check(first.Join(3000) && error == null && state.Revoked);
            Check(effects == (mode == "revoke-first" ? 0 : 1));
            if (decision != null) state.SettleForTest(decision.Acknowledgment);
            else Check(state.Inspect(OperationId, digest).Unknown);
        }
        return effects;
    }
}
#endif
