#if HV_SOCKET_TEST
using System;
using System.Collections.Generic;
using System.Threading;
using Aegis.ProtectedSession;

internal sealed class ModeledClock : IHvSocketClock
{
    internal long Value = 0;
    internal Action OnRead = null;
    public long Milliseconds { get { if (OnRead != null) OnRead(); return Value; } }
}

// Only this native boundary is modeled. Frame/deadline/budget/refusal logic is
// the same HvSocketTransport implementation compiled into the actual helper.
internal sealed class ModeledSocket : IHvSocketIo
{
    internal readonly ModeledClock Clock = new ModeledClock();
    internal readonly List<byte> Output = new List<byte>();
    internal readonly List<byte[]> OwnedBuffers = new List<byte[]>();
    internal byte[] Input = new byte[0], PeerAddress = new HvSocketEndpoint(Cases.Vm).Address();
    internal byte[] RequestedAddress = null;
    internal int Position = 0, Chunk = 4096, ConnectError = 0, SocketError = 0;
    internal int Opens = 0, Closes = 0, PeerReads = 0, Transfers = 0, Waits = 0, MaximumWait = 0;
    internal int FailAt = -1, FailWriteAt = -1, WouldBlockReads = 0, WouldBlockWrites = 0;
    internal int TransferMilliseconds = 0, WaitMilliseconds = -1, Ready = -1, PeerChangeAt = -1;
    internal bool PeerUnavailable = false, CloseFails = false, SendZero = false, OpenFails = false;
    internal bool Closed = false, FailWait = false, FailErrorQuery = false;
    internal Action OnOpen = null, OnConnect = null, OnTransfer = null, OnWait = null, OnPeer = null, OnClose = null;
    internal ManualResetEvent Entered = null, Continue = null;

    public void Open()
    { Opens++; if (OnOpen != null) OnOpen(); if (OpenFails) throw new InvalidOperationException("modeled-open"); }
    public int Connect(byte[] address)
    { RequestedAddress = (byte[])address.Clone(); if (OnConnect != null) OnConnect(); return ConnectError; }
    public int Error()
    { if (FailErrorQuery) throw new InvalidOperationException("modeled-error-query"); return SocketError; }
    public byte[] Peer()
    {
        PeerReads++; if (OnPeer != null) OnPeer();
        if (PeerUnavailable) throw new InvalidOperationException("modeled-peer-unavailable");
        byte[] value = (byte[])PeerAddress.Clone();
        if (PeerChangeAt >= 0 && PeerReads >= PeerChangeAt) value[4] ^= 1;
        return value;
    }
    public int Wait(bool read, bool write, int milliseconds)
    {
        HvSocketFixture.Require(!Closed && read != write && milliseconds > 0 && milliseconds <= 20);
        Waits++; MaximumWait = Math.Max(MaximumWait, milliseconds);
        Clock.Value += WaitMilliseconds < 0 ? milliseconds : WaitMilliseconds;
        if (OnWait != null) OnWait();
        if (FailWait) throw new InvalidOperationException("modeled-wait");
        return Ready < 0 ? (read ? 1 : 2) : Ready;
    }
    private void Transfer(byte[] bytes)
    {
        HvSocketFixture.Require(!Closed); Transfers++; OwnedBuffers.Add(bytes); Clock.Value += TransferMilliseconds;
        if (OnTransfer != null) OnTransfer();
        if (Entered != null)
        {
            Entered.Set(); HvSocketFixture.Require(Continue.WaitOne(1000)); Entered = null;
        }
    }
    public int Receive(byte[] bytes, int offset, int count, out int error)
    {
        Transfer(bytes); error = 0;
        if (WouldBlockReads > 0) { WouldBlockReads--; error = 10035; return -1; }
        if (FailAt >= 0 && Position >= FailAt) { error = 10054; return -1; }
        int available = Math.Min(count, Math.Min(Chunk, Input.Length - Position));
        if (FailAt >= 0) available = Math.Min(available, FailAt - Position);
        if (available > 0) { Buffer.BlockCopy(Input, Position, bytes, offset, available); Position += available; }
        return available;
    }
    public int Send(byte[] bytes, int offset, int count, out int error)
    {
        Transfer(bytes); error = 0;
        if (WouldBlockWrites > 0) { WouldBlockWrites--; error = 10035; return -1; }
        if (FailWriteAt >= 0 && Output.Count >= FailWriteAt) { error = 10054; return -1; }
        if (SendZero) return 0;
        int actual = Math.Min(count, Chunk);
        if (FailWriteAt >= 0) actual = Math.Min(actual, FailWriteAt - Output.Count);
        for (int index = 0; index < actual; index++) Output.Add(bytes[offset + index]);
        return actual;
    }
    public void Close()
    {
        HvSocketFixture.Require(!Closed); Closes++; Closed = true;
        if (OnClose != null) OnClose();
        if (CloseFails) throw new InvalidOperationException("modeled-close");
    }
}
#endif
