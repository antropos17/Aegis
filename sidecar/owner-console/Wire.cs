using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// Bounded ASCII frames. A timed-out stream must never be reused.
internal static class OwnerWire
{
    internal const int MaxFrame = 24576;
    internal const int MaxPreview = 16384;
    private static readonly Encoding Ascii = Encoding.GetEncoding("us-ascii", EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);

    internal static string Read(Stream stream, int timeoutMs)
    {
        byte[] length = new byte[4];
        ReadExact(stream, length, timeoutMs);
        uint n = (uint)(length[0] | length[1] << 8 | length[2] << 16 | length[3] << 24);
        if (n == 0 || n > MaxFrame) throw new InvalidDataException("invalid frame length");
        byte[] body = new byte[n];
        ReadExact(stream, body, timeoutMs);
        string result = Ascii.GetString(body);
        foreach (char c in result) if (c < 0x20 || c > 0x7e) throw new InvalidDataException("invalid frame characters");
        return result;
    }

    internal static void Write(Stream stream, string frame, int timeoutMs)
    {
        byte[] body = Ascii.GetBytes(frame);
        if (body.Length == 0 || body.Length > MaxFrame) throw new InvalidDataException("invalid frame length");
        foreach (byte b in body) if (b < 0x20 || b > 0x7e) throw new InvalidDataException("invalid frame characters");
        byte[] data = new byte[body.Length + 4];
        uint n = (uint)body.Length;
        data[0] = (byte)n; data[1] = (byte)(n >> 8); data[2] = (byte)(n >> 16); data[3] = (byte)(n >> 24);
        Buffer.BlockCopy(body, 0, data, 4, body.Length);
        IAsyncResult pending = stream.BeginWrite(data, 0, data.Length, null, null);
        using (WaitHandle wait = pending.AsyncWaitHandle)
        {
            if (!wait.WaitOne(timeoutMs)) throw new TimeoutException();
            stream.EndWrite(pending);
        }
        // Some process stdio streams buffer completed writes. Flush on a
        // background thread so an unresponsive peer cannot hold this process
        // past the deadline; the caller must terminate the session on failure.
        Task flush=Task.Factory.StartNew(delegate { stream.Flush(); });
        if(!flush.Wait(timeoutMs)) throw new TimeoutException();
    }

    private static void ReadExact(Stream stream, byte[] buffer, int timeoutMs)
    {
        int position = 0;
        Stopwatch elapsed = Stopwatch.StartNew();
        while (position < buffer.Length)
        {
            int remaining = (int)Math.Max(0, timeoutMs - elapsed.ElapsedMilliseconds);
            if (remaining == 0) throw new TimeoutException();
            IAsyncResult pending = stream.BeginRead(buffer, position, buffer.Length - position, null, null);
            using (WaitHandle wait = pending.AsyncWaitHandle)
            {
                if (!wait.WaitOne(remaining)) throw new TimeoutException();
                int count = stream.EndRead(pending);
                if (count == 0) throw new EndOfStreamException();
                position += count;
            }
        }
    }

    internal static bool IsChallenge(string value)
    {
        if (value == null || value.Length != 32) return false;
        foreach (char c in value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }

    internal static bool ValidPreview(string encoded)
    {
        try
        {
            byte[] data = Convert.FromBase64String(encoded);
            if (data.Length == 0 || data.Length > MaxPreview || Convert.ToBase64String(data) != encoded) return false;
            foreach (byte b in data) if (b != 0x0a && (b < 0x20 || b > 0x7e)) return false;
            return true;
        }
        catch (FormatException) { return false; }
    }

    internal static byte[] Random(int count)
    {
        byte[] value = new byte[count];
        using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(value);
        return value;
    }

    internal static byte[] Mac(byte[] key, string role, byte[] serverNonce, byte[] clientNonce)
    {
        byte[] label = Ascii.GetBytes("AEGIS owner console v1 " + role + " ");
        byte[] input = new byte[label.Length + serverNonce.Length + clientNonce.Length];
        Buffer.BlockCopy(label, 0, input, 0, label.Length);
        Buffer.BlockCopy(serverNonce, 0, input, label.Length, serverNonce.Length);
        Buffer.BlockCopy(clientNonce, 0, input, label.Length + serverNonce.Length, clientNonce.Length);
        using (HMACSHA256 hmac = new HMACSHA256(key)) return hmac.ComputeHash(input);
    }

    internal static bool Equal(byte[] a, byte[] b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        int different = 0;
        for (int i = 0; i < a.Length; i++) different |= a[i] ^ b[i];
        return different == 0;
    }
}
