using System.Buffers.Binary;
using System.IO.Pipes;

namespace Aegis.EtwLifecycle;

// Fixture-owned transport observation only. Private packet bytes still pass
// unchanged through the linked production framing, parser and guard command loop.
internal sealed class ObservedOwnerStream(NamedPipeClientStream pipe) : Stream
{
    internal NamedPipeClientStream Pipe => pipe;
    private readonly byte[] header = new byte[4];
    private int received, expected = -1;
    private bool firstRead, firstWrite, firstPacket, firstReply;
    private int written, expectedWrite = -1;
    public override bool CanRead => pipe.CanRead;
    public override bool CanSeek => false;
    public override bool CanWrite => pipe.CanWrite;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() => pipe.Flush();
    public override Task FlushAsync(CancellationToken token) => pipe.FlushAsync(token);
    public override int Read(byte[] buffer, int offset, int count) => throw new InvalidOperationException("fixture-sync-read-forbidden");
    public override void Write(byte[] buffer, int offset, int count) => throw new InvalidOperationException("fixture-sync-write-forbidden");
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (!firstRead) { firstRead = true; Program.Event("owner-read-started"); }
        int count = await pipe.ReadAsync(buffer, cancellationToken);
        int copied = Math.Min(count, Math.Max(0, 4 - received));
        for (int index = 0; index < copied; index++) header[received + index] = buffer.Span[index];
        received += count;
        if (received >= 4 && expected < 0) expected = checked(4 + BinaryPrimitives.ReadInt32LittleEndian(header));
        if (!firstPacket && expected >= 4 && received >= expected) { firstPacket = true; Program.Event("owner-reserve-packet-read"); }
        return count;
    }
    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (!firstWrite)
        {
            firstWrite = true;
            Program.Event("owner-reserve-reply-started");
            if (Program.Case == "guard-exit-before-reserved") Environment.Exit(72);
            if (Program.Case == "bad-broker-ack-guard-pending") await Task.Delay(Timeout.Infinite, cancellationToken);
            if (Program.DelayedReply) await Task.Delay(3000, cancellationToken);
        }
        if (written == 0 && buffer.Length == 4) expectedWrite = checked(4 + BinaryPrimitives.ReadInt32LittleEndian(buffer.Span));
        if ((Program.Case is "bad-guard-ack" or "bad-guard-ack-broker-pending") && written == 4)
        {
            string json = System.Text.Encoding.UTF8.GetString(buffer.Span);
            if (!json.Contains("\"reserved\"", StringComparison.Ordinal)) throw new InvalidDataException("fixture-response-seam");
            buffer = System.Text.Encoding.UTF8.GetBytes(json.Replace("\"reserved\"", "\"rejected\"", StringComparison.Ordinal));
        }
        await pipe.WriteAsync(buffer, cancellationToken);
        written += buffer.Length;
        if (!firstReply && expectedWrite >= 4 && written >= expectedWrite) { firstReply = true; Program.Event("owner-reserve-reply-completed"); }
    }
    protected override void Dispose(bool disposing) { if (disposing) pipe.Dispose(); base.Dispose(disposing); }
}
