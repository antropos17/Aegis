#if PROTECTED_OPERATION_TEST
using System;
using System.Collections.Generic;
using System.IO;
using Aegis.ProtectedSession;

// Simulated acknowledgments only. No file, native service or management operation.
internal sealed class FixtureStore : IProtectedOperationFixtureStore
{
    internal readonly List<byte[]> Frames = new List<byte[]>();
    internal string Fault;
    internal int FailAt, Commits, PartialWrites;
    internal Action DuringCommit;
    public byte[][] Snapshot()
    {
        var copy = new byte[Frames.Count][];
        for (int index = 0; index < copy.Length; index++) copy[index] = (byte[])Frames[index].Clone();
        return copy;
    }
    public FixtureStoreAcknowledgment Commit(FixtureCommitAttempt attempt)
    {
        ProtectedOperationRecord.Require(Object.ReferenceEquals(attempt.Store, this) && attempt.ExpectedSequence == Frames.Count &&
            attempt.ExpectedHead == (Frames.Count == 0 ? ProtectedOperationRecord.ZeroHash : EnrollmentInspection.ImageHash(Frames[Frames.Count - 1])));
        Commits++; string fault = FailAt == Commits ? Fault : null;
        if (DuringCommit != null) DuringCommit();
        if (fault == "throw-before") throw new IOException("fixture-before");
        byte[] bytes = attempt.Bytes; int written = bytes.Length;
        if (fault == "zero" || fault == "short") written = fault == "zero" ? 0 : bytes.Length / 2;
        byte[] persisted = new byte[written]; Array.Copy(bytes, persisted, written); Frames.Add(persisted);
        if (fault == "throw-after") throw new IOException("fixture-after");
        if (fault == "short-progress") PartialWrites = bytes.Length / 7 + 1;
        byte[] readback = (byte[])persisted.Clone();
        if (fault == "readback") readback[0] ^= 1;
        if (fault == "torn") Frames[Frames.Count - 1] = new byte[] { (byte)'{' };
        if (fault == "wrong-attempt") attempt = new FixtureCommitAttempt(this, attempt.ExpectedSequence, attempt.ExpectedHead, bytes);
        if (fault == "wrong-store") attempt = new FixtureCommitAttempt(new object(), attempt.ExpectedSequence, attempt.ExpectedHead, bytes);
        return new FixtureStoreAcknowledgment(attempt, written, fault != "sync", fault != "replace", readback);
    }
}
#endif
