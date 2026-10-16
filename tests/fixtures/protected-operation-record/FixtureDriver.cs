#if PROTECTED_OPERATION_TEST
using System;
using System.Collections.Generic;

namespace Aegis.ProtectedSession
{
    // All store/effect code is excluded from production, including these types.
    internal interface IProtectedOperationFixtureStore
    {
        byte[][] Snapshot();
        FixtureStoreAcknowledgment Commit(FixtureCommitAttempt attempt);
    }
    internal sealed class FixtureCommitAttempt
    {
        internal readonly object Store;
        internal readonly uint ExpectedSequence;
        internal readonly string ExpectedHead;
        private readonly byte[] bytes;
        internal byte[] Bytes { get { return (byte[])bytes.Clone(); } }
        internal FixtureCommitAttempt(object store, uint sequence, string head, byte[] frame)
        { Store = store; ExpectedSequence = sequence; ExpectedHead = head; bytes = (byte[])frame.Clone(); }
    }
    internal sealed class FixtureStoreAcknowledgment
    {
        internal readonly FixtureCommitAttempt Attempt;
        internal readonly int Written;
        internal readonly bool Flushed, Published;
        internal readonly byte[] Readback;
        internal FixtureStoreAcknowledgment(FixtureCommitAttempt attempt, int written, bool flushed, bool published, byte[] readback)
        { Attempt = attempt; Written = written; Flushed = flushed; Published = published; Readback = readback == null ? null : (byte[])readback.Clone(); }
    }
    internal sealed class FixtureEffectAcknowledgment
    {
        internal readonly object Owner;
        internal readonly Guid OperationId;
        internal readonly string Digest;
        internal readonly bool Success;
        internal FixtureEffectAcknowledgment(object owner, Guid operation, string digest, bool success)
        { Owner = owner; OperationId = operation; Digest = digest; Success = success; }
    }
    internal sealed class FixtureDispatchDecision
    {
        internal readonly bool Entered;
        internal readonly FixtureEffectAcknowledgment Acknowledgment;
        internal FixtureDispatchDecision(bool entered, FixtureEffectAcknowledgment acknowledgment)
        { Entered = entered; Acknowledgment = acknowledgment; }
    }

    internal sealed partial class ProtectedOperationState
    {
        private IProtectedOperationFixtureStore fixtureStore;
        private bool busy;
        private readonly List<byte[]> fixtureFrames = new List<byte[]>();
        private readonly Dictionary<Guid, FixtureEffectAcknowledgment> effectAcks = new Dictionary<Guid, FixtureEffectAcknowledgment>();
        internal static ProtectedOperationState CreateForTest(ProtectedOperationBinding fixtureBinding, IProtectedOperationFixtureStore store)
        {
            ProtectedOperationRecord.Require(store != null);
            var state = new ProtectedOperationState(fixtureBinding); state.fixtureStore = store;
            state.CheckStore(0, ProtectedOperationRecord.ZeroHash); return state;
        }
        private void CheckStore(uint expectedSequence, string expectedHead, byte[] candidate = null)
        {
            try
            {
                ProtectedOperationRecord.Require(fixtureStore != null);
                byte[][] observed = fixtureStore.Snapshot();
                ProtectedOperationRecord.Require(observed != null && observed.Length == expectedSequence &&
                    observed.Length == fixtureFrames.Count + (candidate == null ? 0 : 1));
                for (int index = 0; index < observed.Length; index++)
                    ProtectedOperationRecord.Require(ProtectedOperationRecord.Equal(observed[index], index < fixtureFrames.Count ? fixtureFrames[index] : candidate));
                string actualHead = observed.Length == 0 ? ProtectedOperationRecord.ZeroHash : EnrollmentInspection.ImageHash(observed[observed.Length - 1]);
                ProtectedOperationRecord.Require(actualHead == expectedHead);
            }
            catch { unavailable = true; throw; }
        }
        private void Enter()
        {
            if (busy) { unavailable = true; ProtectedOperationRecord.Require(false); }
            ProtectedOperationRecord.Require(!unavailable && fixtureStore != null); busy = true;
            try { CheckStore(sequence, head); }
            catch { busy = false; throw; }
        }
        private void Commit(VmOperationRecord intent, ProtectedOperationPhase phase)
        {
            var record = ProtectedOperationRecord.CreateForTest(binding, intent, phase, sequence + 1, head);
            Advance(record, false);
            try
            {
                byte[] frame = record.Encode(); var attempt = new FixtureCommitAttempt(fixtureStore, sequence, head, frame);
                FixtureStoreAcknowledgment ack = fixtureStore.Commit(attempt);
                ProtectedOperationRecord.Require(!unavailable && ack != null && Object.ReferenceEquals(ack.Attempt, attempt) &&
                    Object.ReferenceEquals(ack.Attempt.Store, fixtureStore) && ack.Written == frame.Length && ack.Flushed && ack.Published &&
                    ProtectedOperationRecord.Equal(ack.Readback, frame));
                CheckStore(record.Sequence, record.RecordSha256, frame); Advance(record, true); fixtureFrames.Add(frame);
            }
            catch { unavailable = true; throw; }
        }
        private ProtectedOperationRecord Existing(Guid id)
        {
            ProtectedOperationRecord record;
            ProtectedOperationRecord.Require(operations.TryGetValue(id, out record)); return record;
        }
        internal ProtectedOperationObservation RecordIntentForTest(VmOperationRecord intent)
        {
            lock (gate)
            {
                Enter();
                try
                {
                    var candidate = ProtectedOperationRecord.CreateForTest(binding, intent, ProtectedOperationPhase.RecordedIntent, 1, ProtectedOperationRecord.ZeroHash);
                    ProtectedOperationRecord prior;
                    if (operations.TryGetValue(intent.OperationId, out prior)) ProtectedOperationRecord.Require(prior.OperationSha256 == candidate.OperationSha256);
                    else Commit(intent, ProtectedOperationPhase.RecordedIntent);
                    return Inspect(intent.OperationId, candidate.OperationSha256);
                }
                finally { busy = false; }
            }
        }
        internal ProtectedOperationObservation ConsumeForTest(Guid operationId)
        {
            lock (gate)
            {
                Enter();
                try
                {
                    var prior = Existing(operationId);
                    if (prior.Phase == ProtectedOperationPhase.RecordedIntent) Commit(prior.Intent, ProtectedOperationPhase.DurablyConsumed);
                    return Inspect(operationId, prior.OperationSha256);
                }
                finally { busy = false; }
            }
        }
        internal FixtureDispatchDecision DispatchForTest(Guid operationId, Func<bool> fixtureEffect)
        {
            lock (gate)
            {
                Enter();
                try
                {
                    var prior = Existing(operationId); FixtureEffectAcknowledgment existingAck;
                    if (prior.Phase == ProtectedOperationPhase.DispatchedUnknown || prior.Phase == ProtectedOperationPhase.SettledSuccess || prior.Phase == ProtectedOperationPhase.SettledFailure)
                    { effectAcks.TryGetValue(operationId, out existingAck); return new FixtureDispatchDecision(false, existingAck); }
                    ProtectedOperationRecord.Require(prior.Phase == ProtectedOperationPhase.DurablyConsumed && fixtureEffect != null);
                    Commit(prior.Intent, ProtectedOperationPhase.DispatchedUnknown);
                    bool success;
                    try { success = fixtureEffect(); }
                    catch { return new FixtureDispatchDecision(true, null); }
                    ProtectedOperationRecord.Require(!unavailable && !admissionRevoked);
                    var ack = new FixtureEffectAcknowledgment(this, operationId, prior.OperationSha256, success);
                    effectAcks.Add(operationId, ack); return new FixtureDispatchDecision(true, ack);
                }
                finally { busy = false; }
            }
        }
        internal ProtectedOperationObservation SettleForTest(FixtureEffectAcknowledgment acknowledgment)
        {
            lock (gate)
            {
                Enter();
                try
                {
                    FixtureEffectAcknowledgment original;
                    ProtectedOperationRecord.Require(acknowledgment != null && Object.ReferenceEquals(acknowledgment.Owner, this) &&
                        effectAcks.TryGetValue(acknowledgment.OperationId, out original) && Object.ReferenceEquals(original, acknowledgment));
                    var prior = Existing(acknowledgment.OperationId); ProtectedOperationRecord.Require(prior.OperationSha256 == acknowledgment.Digest);
                    var phase = acknowledgment.Success ? ProtectedOperationPhase.SettledSuccess : ProtectedOperationPhase.SettledFailure;
                    if (prior.Phase != phase) Commit(prior.Intent, phase);
                    return Inspect(acknowledgment.OperationId, acknowledgment.Digest);
                }
                finally { busy = false; }
            }
        }
        internal void RevokeForTest()
        {
            lock (gate)
            {
                admissionRevoked = true; Enter();
                try { if (!recordedRevoked) Commit(null, ProtectedOperationPhase.RevokedAdmission); }
                finally { busy = false; }
            }
        }
    }
}
#endif
