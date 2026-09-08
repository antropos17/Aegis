namespace Aegis.EtwLifecycle;

// A terminal frame and an independent cleanup receipt are different observations.
// Neither a clean exit nor receipt delivery can turn unavailable ETW stats into zero.
internal static class FinalEvidence
{
    internal static void ValidateReceipt(Frame frame, string outcome, TraceStats? primary, bool acknowledged)
    {
        if (frame.Kind != "cleanup" || frame.Seq != "1" || frame.Code != outcome ||
            (acknowledged && frame.Stats != primary)) throw new InvalidDataException();
    }

    internal static bool Accepts(bool live, string scenario, BrokerResult result, int brokerExit)
    {
        bool expected = scenario switch
        {
            "stop" => result.Outcome == "stop" && result.PeerExitCode == 0 && result.StopAcknowledged,
            "parent-eof" => result.Outcome == "parent-eof" && result.PeerExitCode == 0 && result.StopAcknowledged,
            "lease" => result.Outcome == "lease-expired" && result.PeerExitCode == 9 && result.StopAcknowledged,
            "peer-exit" => !live && result.Outcome == "peer-failed" && result.PeerExitCode == 7,
            "peer-kill" => !live && result.Outcome == "eof" && result.PeerExitCode is not null and not 0 && !result.StopAcknowledged && !result.CleanupReceiptReceived,
            "blocked-write" => result.Outcome == "write-timeout" && result.PeerExitCode == 10 && !result.StopAcknowledged,
            _ => false
        };
        bool native = !live ? result.InitialStats == null && result.FinalStats == null :
            result.InitialStats is { QueryStatus: 0, NumberOfBuffers: > 0, BufferSizeKiB: > 0 } &&
            result.FinalStats is { QueryStatus: 0, AbsentStatus: 4201, EventsLost: not null, RealTimeBuffersLost: not null, LogBuffersLost: not null };
        bool receipt = !live && scenario == "peer-kill" || result.CleanupReceiptReceived;
        return expected && native && receipt && result.Live == live && result.Scenario == scenario &&
            result.Authenticated && result.RestrictedAcl && brokerExit == 0;
    }
}
