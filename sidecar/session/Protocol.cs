using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // Canonical v1 has two operations and no authority-bearing fields.
    internal static class Protocol
    {
        internal const int MaxFrameBytes = 2048;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly Regex RequestPattern = new Regex(
            "\\A\\{\"protocol\":\"aegis-protected-session\",\"version\":1," +
            "\"operation\":\"(probe|prepare)\",\"requestId\":\"([a-f0-9]{32})\"," +
            "\"sessionId\":\"([a-f0-9]{32})\"\\}\\z", RegexOptions.CultureInvariant);

        internal sealed class Request
        {
            internal string Operation, RequestId, SessionId;
        }

        internal static Request Read(Stream input)
        {
            byte[] header = ReadExactly(input, 4);
            uint length = (uint)header[0] | ((uint)header[1] << 8) |
                ((uint)header[2] << 16) | ((uint)header[3] << 24);
            if (length == 0 || length > MaxFrameBytes)
                throw new InvalidDataException();
            byte[] payload = ReadExactly(input, (int)length);
            // v1 accepts one frame, then EOF. Never parse a second command.
            if (input.ReadByte() != -1) throw new InvalidDataException();
            Match match = RequestPattern.Match(Utf8.GetString(payload));
            if (!match.Success) throw new InvalidDataException();
            return new Request {
                Operation = match.Groups[1].Value,
                RequestId = match.Groups[2].Value,
                SessionId = match.Groups[3].Value
            };
        }

        private static byte[] ReadExactly(Stream input, int length)
        {
            byte[] bytes = new byte[length];
            int offset = 0;
            while (offset < length)
            {
                int read = input.Read(bytes, offset, length - offset);
                if (read == 0) throw new EndOfStreamException();
                offset += read;
            }
            return bytes;
        }

        internal static void WriteUnavailable(Stream output, Request request)
        {
            string json = "{\"protocol\":\"aegis-protected-session\",\"version\":1," +
                "\"operation\":\"" + request.Operation + "\",\"requestId\":\"" +
                request.RequestId + "\",\"sessionId\":\"" + request.SessionId + "\"," +
                "\"state\":\"unavailable\",\"reason\":\"containment-unavailable\"," +
                "\"launchAllowed\":false}";
            byte[] payload = Utf8.GetBytes(json);
            int length = payload.Length;
            output.WriteByte((byte)length);
            output.WriteByte((byte)(length >> 8));
            output.WriteByte((byte)(length >> 16));
            output.WriteByte((byte)(length >> 24));
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }
    }
}
