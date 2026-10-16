using System;
using System.Collections.Generic;

namespace Aegis.ProtectedSession
{
    internal sealed class ProtectedOperationObservation
    {
        internal readonly VmOperationRecord Intent;
        internal readonly ProtectedOperationPhase? Phase;
        internal readonly string OperationSha256;
        internal readonly bool Revoked, Unavailable, Unknown;
        internal ProtectedOperationObservation(ProtectedOperationRecord record, bool revoked, bool unavailable)
        {
            Intent = record == null ? null : record.Intent; Phase = record == null ? (ProtectedOperationPhase?)null : record.Phase;
            OperationSha256 = record == null ? null : record.OperationSha256; Revoked = revoked; Unavailable = unavailable;
            Unknown = Phase == ProtectedOperationPhase.DurablyConsumed || Phase == ProtectedOperationPhase.DispatchedUnknown;
        }
    }

    // Replay is a bounded prefix observation. It never constructs restart or effect authority.
    internal sealed partial class ProtectedOperationState
    {
        internal const int MaximumOperations = 256, MaximumRecords = MaximumOperations * 4 + 1;
        private readonly ProtectedOperationBinding binding;
        private readonly Dictionary<Guid, ProtectedOperationRecord> operations = new Dictionary<Guid, ProtectedOperationRecord>();
        private readonly object gate = new object();
        private bool recordedRevoked, admissionRevoked, unavailable;
        private uint sequence;
        private string head = ProtectedOperationRecord.ZeroHash;
        private ProtectedOperationState(ProtectedOperationBinding expected)
        { ProtectedOperationRecord.Require(expected != null); binding = expected; admissionRevoked = false; unavailable = false; }
        internal bool Revoked { get { lock (gate) return recordedRevoked || admissionRevoked; } }
        internal uint Sequence { get { lock (gate) return sequence; } }
        internal string HeadSha256 { get { lock (gate) return head; } }
        internal string ReplayStatus { get { return "PrefixOnly"; } }
        internal static ProtectedOperationState Replay(ProtectedOperationBinding expected, byte[][] exactFrames)
        {
            ProtectedOperationRecord.Require(exactFrames != null && exactFrames.Length <= MaximumRecords);
            var state = new ProtectedOperationState(expected);
            foreach (byte[] frame in exactFrames) state.Advance(ProtectedOperationRecord.Parse(frame), true);
            return state;
        }
        internal ProtectedOperationObservation Inspect(Guid operationId, string expectedOperationSha256)
        {
            lock (gate)
            {
                ProtectedOperationRecord.Require(operationId != Guid.Empty); ProtectedOperationRecord record;
                operations.TryGetValue(operationId, out record);
                ProtectedOperationRecord.Require(record == null || record.OperationSha256 == expectedOperationSha256);
                return new ProtectedOperationObservation(record, Revoked, unavailable);
            }
        }
        // The same validator handles committed replay and acknowledged fixture transitions.
        private void Advance(ProtectedOperationRecord record, bool apply)
        {
            ProtectedOperationRecord.Require(record.Binding.Canonical == binding.Canonical && sequence < MaximumRecords &&
                record.Sequence == sequence + 1 && record.PreviousSha256 == head);
            if (record.Phase == ProtectedOperationPhase.RevokedAdmission)
                ProtectedOperationRecord.Require(!recordedRevoked);
            else
            {
                Guid id = record.Intent.OperationId; ProtectedOperationRecord prior; operations.TryGetValue(id, out prior);
                if (prior == null)
                    ProtectedOperationRecord.Require(!Revoked && operations.Count < MaximumOperations && record.Phase == ProtectedOperationPhase.RecordedIntent);
                else
                {
                    ProtectedOperationRecord.Require(prior.OperationSha256 == record.OperationSha256);
                    bool consume = prior.Phase == ProtectedOperationPhase.RecordedIntent && record.Phase == ProtectedOperationPhase.DurablyConsumed;
                    bool dispatch = prior.Phase == ProtectedOperationPhase.DurablyConsumed && record.Phase == ProtectedOperationPhase.DispatchedUnknown;
                    bool settle = prior.Phase == ProtectedOperationPhase.DispatchedUnknown &&
                        (record.Phase == ProtectedOperationPhase.SettledSuccess || record.Phase == ProtectedOperationPhase.SettledFailure);
                    ProtectedOperationRecord.Require((consume || dispatch || settle) && (settle || !Revoked));
                    if (consume || dispatch)
                        foreach (var item in operations)
                            ProtectedOperationRecord.Require(item.Key == id || (item.Value.Phase != ProtectedOperationPhase.DurablyConsumed &&
                                item.Value.Phase != ProtectedOperationPhase.DispatchedUnknown));
                }
            }
            if (!apply) return;
            if (record.Phase == ProtectedOperationPhase.RevokedAdmission) recordedRevoked = true;
            else operations[record.Intent.OperationId] = record;
            sequence = record.Sequence; head = record.RecordSha256;
        }
    }
}
