using System;
using System.IO;
using System.Text;

/// <summary>
/// aegis-procsnap — the process-snapshot sidecar.
///
/// One job: answer `snap` requests with the whole process table, over stdio, in
/// length-prefixed frames. It holds no state about AEGIS, makes no policy decision,
/// and exits the moment its stdin closes, so it can never outlive the app that
/// spawned it.
///
/// It also refuses to start when it cannot vouch for what it would report: the
/// startup probe checks the snapshot against an independent oracle, and a failure
/// exits non-zero with a stderr line instead of emitting plausible numbers. The
/// caller treats a dead sidecar as a fallback condition, which is the honest outcome.
///
/// See README.md in this directory for the wire contract.
/// </summary>
public static class Program {
    /// <summary>Wire protocol version. Must match proc-snapshot-protocol.js.</summary>
    private const int Proto = 1;

    /// <summary>Largest frame accepted, matching the JavaScript decoder's ceiling.</summary>
    private const int MaxFrame = 8 * 1024 * 1024;

    private static Stream _stdout;

    public static int Main(string[] args) {
        string probeFailure = NtSnapshot.Probe();
        if (probeFailure != null) {
            Console.Error.WriteLine("probe failed: " + probeFailure);
            return 2;
        }

        Stream stdin = Console.OpenStandardInput();
        _stdout = Console.OpenStandardOutput();
        WriteFrame(NtSnapshot.HelloJson(Proto));

        byte[] header = new byte[4];
        while (true) {
            if (!ReadExact(stdin, header, 4)) return 0; // stdin closed: the parent is gone
            long length = (long)((uint)header[0] | ((uint)header[1] << 8) | ((uint)header[2] << 16) | ((uint)header[3] << 24));
            if (length <= 0 || length > MaxFrame) {
                Console.Error.WriteLine("desynchronised: frame length " + length);
                return 3;
            }
            byte[] payload = new byte[length];
            if (!ReadExact(stdin, payload, (int)length)) return 0;

            string text = Encoding.UTF8.GetString(payload);
            string type = Json.ReadStringField(text, "t");
            long id = Json.ReadNumberField(text, "id");
            if (type == "snap") {
                try {
                    WriteFrame(NtSnapshot.SnapshotJson(id));
                } catch (Exception ex) {
                    WriteFrame(Json.ErrorFrame(id, "snapshot-failed", ex.Message));
                }
            } else {
                WriteFrame(Json.ErrorFrame(id, "unknown-request", type == null ? "" : type));
            }
        }
    }

    /// <summary>Read exactly count bytes, or report end of stream.</summary>
    private static bool ReadExact(Stream stream, byte[] buffer, int count) {
        int filled = 0;
        while (filled < count) {
            int read = stream.Read(buffer, filled, count - filled);
            if (read <= 0) return false;
            filled += read;
        }
        return true;
    }

    /// <summary>Write one length-prefixed UTF-8 JSON frame.</summary>
    private static void WriteFrame(string json) {
        byte[] payload = Encoding.UTF8.GetBytes(json);
        byte[] header = new byte[4];
        header[0] = (byte)(payload.Length & 0xFF);
        header[1] = (byte)((payload.Length >> 8) & 0xFF);
        header[2] = (byte)((payload.Length >> 16) & 0xFF);
        header[3] = (byte)((payload.Length >> 24) & 0xFF);
        _stdout.Write(header, 0, 4);
        _stdout.Write(payload, 0, payload.Length);
        _stdout.Flush();
    }
}
