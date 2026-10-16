#if HV_SOCKET_TEST
using System;
using System.Threading;
using Aegis.ProtectedSession;

internal static class Cases
{
    internal static readonly Guid Vm = new Guid("11111111-2222-4333-8444-555555555555");
    internal static void Check(bool value) { HvSocketFixture.Require(value); }
    internal static void Refuses(Action action)
    {
        bool refused = false;
        try { action(); } catch (InvalidOperationException) { refused = true; }
        Check(refused);
    }
    internal static HvSocketTransport Open(ModeledSocket io, CancellationToken token)
    { return HvSocketTransport.ConnectForTest(Vm, io, io.Clock, token); }
    internal static HvSocketTransport Open(ModeledSocket io) { return Open(io, CancellationToken.None); }
    internal static byte[] Frame(byte[] payload)
    {
        byte[] value = new byte[4 + payload.Length];
        value[0] = (byte)payload.Length; value[1] = (byte)(payload.Length >> 8);
        Buffer.BlockCopy(payload, 0, value, 4, payload.Length); return value;
    }
    internal static void Equal(byte[] actual, byte[] expected)
    {
        Check(actual.Length == expected.Length);
        for (int index = 0; index < expected.Length; index++) Check(actual[index] == expected[index]);
    }
    internal static void Terminal(HvSocketTransport connection, ModeledSocket io)
    {
        int calls = io.Transfers, opens = io.Opens;
        Refuses(delegate { connection.WriteFrame(new byte[] { 82 }); });
        Refuses(delegate { connection.ReadFrame(); });
        Check(io.Transfers == calls && io.Opens == opens && io.Closes == 1);
        if (io.CloseFails) Refuses(connection.Dispose); else { connection.Dispose(); connection.Dispose(); }
        Check(io.Closes == 1);
    }
    internal static void Cleared(ModeledSocket io)
    {
        foreach (byte[] bytes in io.OwnedBuffers) foreach (byte value in bytes) Check(value == 0);
    }
    internal static void Run(string mode)
    {
        if (mode == "foreign-peer")
        {
            var io = new ModeledSocket(); io.PeerAddress[4] ^= 1;
            Refuses(delegate { Open(io); }); Check(io.Opens == 1 && io.Closes == 1 && io.Transfers == 0); return;
        }
        if (mode == "endpoint")
        {
            var target = new HvSocketEndpoint(Vm); byte[] value = target.Address();
            Check(BitConverter.ToString(value).Replace("-", "").ToLowerInvariant() ==
                "22000000111111112222334384445555555555554e8f956f36740a4a9c0433f639f6b565");
            target.CheckPeer(value); value[4] ^= 1; Refuses(delegate { target.CheckPeer(value); }); return;
        }
        if (mode.StartsWith("target:"))
        {
            var io = new ModeledSocket(); string guid = mode.Substring(7);
            Refuses(delegate { HvSocketTransport.ConnectForTest(new Guid(guid), io, io.Clock, CancellationToken.None); });
            Check(io.Opens == 0 && io.Closes == 0); return;
        }
        if (mode.StartsWith("peer:")) { PeerCases(mode.Substring(5)); return; }
        if (mode.StartsWith("connect:")) { ConnectCases(mode.Substring(8)); return; }
        if (mode.StartsWith("read-failure:")) { ReadFailure(Int32.Parse(mode.Substring(13))); return; }
        if (mode.StartsWith("write-failure:")) { WriteFailure(Int32.Parse(mode.Substring(14))); return; }
        if (mode.StartsWith("length:")) { Length(UInt32.Parse(mode.Substring(7))); return; }
        if (mode.StartsWith("lifecycle:")) { LifetimeCases.Run(mode.Substring(10)); return; }
        if (mode.StartsWith("idle:")) { IdleCases.Run(mode.Substring(5)); return; }
        if (mode.StartsWith("frames:")) { FrameCases(mode.Substring(7)); return; }
        throw new InvalidOperationException("fixture-unknown-mode");
    }
    private static void PeerCases(string change)
    {
        var io = new ModeledSocket();
        if (change == "service") io.PeerAddress[20] ^= 1;
        else if (change == "reserved") io.PeerAddress[2] = 1;
        else if (change == "family") io.PeerAddress[0] = 2;
        else if (change == "short") Array.Resize(ref io.PeerAddress, 35);
        else if (change == "long") Array.Resize(ref io.PeerAddress, 37);
        else if (change == "unsupported") io.PeerUnavailable = true;
        else if (change == "before-frame" || change == "after-frame") io.PeerChangeAt = change == "before-frame" ? 2 : 3;
        else throw new InvalidOperationException("fixture-peer-case");
        if (io.PeerChangeAt < 0) { Refuses(delegate { Open(io); }); Check(io.Transfers == 0 && io.Closes == 1); }
        else
        {
            var connection = Open(io); Refuses(delegate { connection.WriteFrame(new byte[] { 82 }); });
            Check(io.Output.Count == (change == "before-frame" ? 0 : 5)); Terminal(connection, io);
        }
    }
    private static void ConnectCases(string change)
    {
        var io = new ModeledSocket(); var cancellation = new CancellationTokenSource();
        if (change == "pending-success") io.ConnectError = 10035;
        else if (change == "error-ready") { io.ConnectError = 10035; io.Ready = 4; }
        else if (change == "so-error") io.SocketError = 10061;
        else if (change == "refused") io.ConnectError = 10061;
        else if (change == "never-ready") { io.ConnectError = 10035; io.Ready = 0; }
        else if (change == "open-failure") io.OpenFails = true;
        else if (change == "error-query-failure") io.FailErrorQuery = true;
        else if (change == "wait-failure") { io.ConnectError = 10035; io.FailWait = true; }
        else if (change == "cancel-before") cancellation.Cancel();
        else if (change == "cancel-open") io.OnOpen = cancellation.Cancel;
        else if (change == "cancel-connect") io.OnConnect = cancellation.Cancel;
        else if (change == "cancel-wait") { io.ConnectError = 10035; io.OnWait = cancellation.Cancel; }
        else if (change == "cancel-peer") io.OnPeer = cancellation.Cancel;
        else if (change == "expires-peer") io.OnPeer = delegate { io.Clock.Value = 2000; };
        else throw new InvalidOperationException("fixture-connect-case");
        if (change == "pending-success")
        {
            using (var connection = Open(io, cancellation.Token)) Check(io.Waits == 1 && io.MaximumWait == 20);
            Equal(io.RequestedAddress, new HvSocketEndpoint(Vm).Address());
        }
        else { Refuses(delegate { Open(io, cancellation.Token); }); Check(io.Transfers == 0 && io.Closes == 1); }
        Check(io.Opens == (change == "cancel-before" ? 0 : 1)); cancellation.Dispose();
    }
    private static void ReadFailure(int offset)
    {
        var io = new ModeledSocket { Input = Frame(new byte[] { 7, 8, 9, 10 }), FailAt = offset, Chunk = 1 };
        var connection = Open(io); Refuses(delegate { connection.ReadFrame(); });
        Check(io.Position == offset); Cleared(io); Terminal(connection, io);
    }
    private static void WriteFailure(int offset)
    {
        var io = new ModeledSocket { FailWriteAt = offset, Chunk = 1 }; var connection = Open(io);
        byte[] original = new byte[] { 7, 8, 9, 10 };
        Refuses(delegate { connection.WriteFrame(original); });
        Check(io.Output.Count == offset); Equal(original, new byte[] { 7, 8, 9, 10 }); Cleared(io); Terminal(connection, io);
    }
    private static void Length(uint length)
    {
        var io = new ModeledSocket { Input = new byte[] { (byte)length, (byte)(length >> 8), (byte)(length >> 16), (byte)(length >> 24) } };
        var connection = Open(io); Refuses(delegate { connection.ReadFrame(); }); Check(io.Position == 4);
        Cleared(io); Terminal(connection, io);
    }
    private static void FrameCases(string change)
    {
        var io = new ModeledSocket(); var connection = Open(io);
        if (change == "roundtrip")
        {
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes("{\"operation\":\"release\",\"mac\":\"opaque\"}");
            io.Chunk = 1; io.Input = Frame(bytes); Equal(connection.ReadFrame(), bytes);
            connection.WriteFrame(bytes); Equal(io.Output.ToArray(), Frame(bytes)); connection.Dispose(); Check(io.Closes == 1); return;
        }
        if (change == "max")
        {
            byte[] bytes = new byte[4096]; bytes[4095] = 255; io.Input = Frame(bytes);
            Equal(connection.ReadFrame(), bytes); connection.WriteFrame(bytes); Equal(io.Output.ToArray(), Frame(bytes)); connection.Dispose(); return;
        }
        if (change == "copy")
        {
            byte[] bytes = new byte[] { 1, 2, 3 }; io.Chunk = 1;
            io.OnTransfer = delegate { bytes[0] = 99; bytes[1] = 99; bytes[2] = 99; };
            connection.WriteFrame(bytes); Equal(io.Output.ToArray(), Frame(new byte[] { 1, 2, 3 })); Cleared(io); connection.Dispose(); return;
        }
        if (change == "would-block")
        {
            io.WouldBlockReads = 2; io.WouldBlockWrites = 2; io.Input = Frame(new byte[] { 1 });
            Equal(connection.ReadFrame(), new byte[] { 1 }); connection.WriteFrame(new byte[] { 1 });
            Check(io.Waits == 4 && io.MaximumWait <= 20); connection.Dispose(); return;
        }
        if (change == "zero-send") io.SendZero = true;
        else if (change == "eof") io.Input = new byte[] { 1, 0 };
        else if (change == "empty-write" || change == "large-write" || change == "null-write") { }
        else throw new InvalidOperationException("fixture-frame-case");
        if (change == "eof") Refuses(delegate { connection.ReadFrame(); });
        else Refuses(delegate { connection.WriteFrame(change == "null-write" ? null : new byte[change == "large-write" ? 4097 : change == "empty-write" ? 0 : 1]); });
        Cleared(io); Terminal(connection, io);
    }
}
#endif
