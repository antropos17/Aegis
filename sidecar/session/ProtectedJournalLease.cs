using System;
using System.Collections.Generic;

namespace Aegis.ProtectedSession
{
    // This acknowledgment describes metadata persistence. It carries no effect permission.
    internal sealed class ProtectedJournalAcknowledgment
    {
        private readonly ProtectedJournalLease owner;
        internal readonly uint Sequence;
        internal readonly string HeadSha256;
        internal ProtectedJournalAcknowledgment(ProtectedJournalLease original, uint sequence, string head)
        { owner = original; Sequence = sequence; HeadSha256 = head; }
        internal void CheckCurrent(ProtectedJournalLease original)
        { ProtectedJournalRegistration.Require(Object.ReferenceEquals(owner, original)); owner.CheckAcknowledgment(this); }
    }

    internal sealed class ProtectedJournalLease : IDisposable
    {
        private readonly InstalledJournalAuthority authority;
        private readonly object gate;
        private readonly object callerGate;
        private readonly object leaseGate = new object();
        private readonly ProtectedJournalNative native;
        private readonly ProtectedJournalRegistration registration;
        private readonly ProtectedOperationBinding binding;
        private readonly List<byte[]> frames = new List<byte[]>();
        private readonly List<ProtectedJournalAcknowledgment> acknowledgments = new List<ProtectedJournalAcknowledgment>();
        private byte[] prefix = new byte[0];
        private ProtectedOperationState state;
        private bool failed, closed, busy;
#if PROTECTED_JOURNAL_TEST
        private Action checkForTest;
#endif
        private ProtectedJournalLease(InstalledJournalAuthority owner, object ownerGate, object originalCallerGate, ProtectedJournalRegistration record,
            ProtectedOperationBinding expected, ProtectedJournalNative held)
        {
            authority = owner; gate = ownerGate; callerGate = originalCallerGate; native = held; registration = record; binding = expected;
            state = ProtectedOperationState.Replay(binding, new byte[0][]);
        }
        internal static ProtectedJournalLease Issue(InstalledOwnerRegistration owner, InstalledVmInspection inspection)
        { ProtectedJournalRegistration.Require(owner != null && inspection != null); return owner.IssueJournal(inspection); }
        internal static ProtectedJournalLease Create(InstalledJournalAuthority authority, ProtectedJournalNative native)
        {
            var lease = new ProtectedJournalLease(authority, authority.Gate, authority.CallerGate, authority.Registration, authority.Binding, native);
            try { lease.Initialize(); return lease; } catch { lease.Dispose(); throw; }
        }
        private void CheckAuthority()
        {
            ProtectedJournalRegistration.Require(!failed && !closed && !CallerNative.HasThreadToken());
            if (authority != null) authority.Check();
#if PROTECTED_JOURNAL_TEST
            else { ProtectedJournalRegistration.Require(checkForTest != null); checkForTest(); }
#else
            else ProtectedJournalRegistration.Require(false);
#endif
            registration.CheckBinding(binding); native.Check();
        }
        private void Initialize()
        {
            lock (callerGate)
            lock (gate)
            lock (leaseGate)
            {
                try
                {
                    CheckAuthority(); ProtectedJournalRegistration.Require(native.ReadAll().Length == 0);
                    prefix = native.Append(prefix, registration.Header(binding)); CheckAuthority();
                }
                catch { failed = true; throw; }
            }
        }
        internal ProtectedJournalAcknowledgment Append(byte[] exactFrame, uint expectedSequence, string expectedHead)
        {
            lock (callerGate)
            lock (gate)
            lock (leaseGate)
            {
                if (busy) { failed = true; ProtectedJournalRegistration.Require(false); }
                busy = true;
                try
                {
                    CheckAuthority(); ProtectedJournalRegistration.Require(expectedSequence == state.Sequence && expectedHead == state.HeadSha256);
                    ProtectedOperationRecord record = ProtectedOperationRecord.Parse(exactFrame);
                    var next = new List<byte[]>(frames); next.Add(record.Encode());
                    ProtectedOperationState candidate = ProtectedOperationState.Replay(binding, next.ToArray());
                    byte[] committed = native.Append(prefix, record.Encode()); CheckAuthority();
                    // Local disposal/failure and acknowledgment issuance share the original owner's gate.
                    prefix = committed; frames.Add(record.Encode()); state = candidate;
                    var acknowledgment = new ProtectedJournalAcknowledgment(this, state.Sequence, state.HeadSha256);
                    acknowledgments.Add(acknowledgment); return acknowledgment;
                }
                catch { failed = true; throw; }
                finally { busy = false; }
            }
        }
        internal ProtectedOperationObservation Inspect(Guid operation, string digest)
        {
            lock (callerGate)
            lock (gate)
            lock (leaseGate)
            {
                try { CheckAuthority(); ProtectedJournalRegistration.Require(ProtectedOperationRecord.Equal(native.ReadAll(), prefix)); return state.Inspect(operation, digest); }
                catch { failed = true; throw; }
            }
        }
        internal void CheckAcknowledgment(ProtectedJournalAcknowledgment acknowledgment)
        {
            lock (callerGate)
            lock (gate)
            lock (leaseGate)
            {
                try
                {
                    CheckAuthority(); ProtectedJournalRegistration.Require(acknowledgments.Contains(acknowledgment) &&
                        ProtectedOperationRecord.Equal(native.ReadAll(), prefix));
                }
                catch { failed = true; throw; }
            }
        }
        public void Dispose()
        {
            lock (callerGate)
            lock (gate)
            lock (leaseGate)
            {
                if (closed) return; closed = true; failed = true;
                try { native.Dispose(); }
                finally { if (authority != null) authority.Dispose(); }
            }
        }
#if PROTECTED_JOURNAL_TEST
        internal static ProtectedJournalLease CreateForTest(object ownerGate, Action check, ProtectedJournalRegistration record,
            ProtectedOperationBinding binding, ProtectedJournalNative native)
        { return CreateForTest(ownerGate, ownerGate, check, record, binding, native); }
        internal static ProtectedJournalLease CreateForTest(object ownerGate, object callerGate, Action check, ProtectedJournalRegistration record,
            ProtectedOperationBinding binding, ProtectedJournalNative native)
        {
            var lease = new ProtectedJournalLease(null, ownerGate, callerGate, record, binding, native); lease.checkForTest = check;
            try { lease.Initialize(); return lease; } catch { lease.Dispose(); throw; }
        }
#endif
    }
}
