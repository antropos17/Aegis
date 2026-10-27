using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Runs only in the supervisor-owned process. Its standard input and output are
// private control pipes; the two console handles are supplied by the supervisor.
internal static class ConsoleWorker
{
    private const int MaxFrame = 24576;
    private const int MaxPreview = 16384;
    private const int PollMilliseconds = 20;
    private const int MaxEventsPerScan = 256;
    private const int MaxProbeNonces = 4096;
    private const ushort KeyEvent = 1;
    private const uint DangerousModifiers = 0x0001 | 0x0002 | 0x0004 | 0x0008;
#if OWNER_CONSOLE_TEST
    internal static Action BeforeWriteForTest;
    internal static Action BeforeInputReadForTest;
    internal static Action BeforeProbeCheckForTest;
#endif

    [StructLayout(LayoutKind.Explicit, Size = 20)]
    private struct InputRecord
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public int KeyDown;
        [FieldOffset(8)] public ushort RepeatCount;
        [FieldOffset(10)] public ushort VirtualKey;
        [FieldOffset(14)] public char UnicodeChar;
        [FieldOffset(16)] public uint ControlKeyState;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNumberOfConsoleInputEvents(IntPtr handle, out uint count);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool PeekConsoleInput(IntPtr handle, [Out] InputRecord[] records, uint length, out uint read);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ReadConsoleInput(IntPtr handle, [Out] InputRecord[] records, uint length, out uint read);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool WriteConsole(IntPtr handle, string value, uint length, out uint written, IntPtr reserved);

    private sealed class Request
    {
        internal string Challenge;
        internal string Preview;
    }

    private sealed class Control
    {
        internal readonly object Gate = new object();
        internal Request Pending;
        internal bool Received;
        internal bool Closed;
        internal string Probe;
        internal readonly HashSet<string> UsedNonces = new HashSet<string>(StringComparer.Ordinal);
    }

    internal static int Run(IntPtr consoleIn, IntPtr consoleErr, Stream controlIn, Stream controlOut)
    { return Run(consoleIn,consoleErr,controlIn,controlOut,null); }

    internal static int Run(IntPtr consoleIn, IntPtr consoleErr, Stream controlIn, Stream controlOut,string profileDisclosure)
    {
        Control state = new Control();
        string challenge = null;
        bool approved = false;
        try
        {
            if (!ConsoleHealthy(consoleIn, consoleErr) || HasUnexpectedInput(consoleIn))
            {
                Send(controlOut, "L");
                return 2;
            }
            Send(controlOut, "H 1");
            Thread reader = new Thread(delegate() { ReadControl(controlIn, state); });
            reader.IsBackground = true;
            reader.Start();
            string answer = "";
            while (true)
            {
                if (!ConsoleHealthy(consoleIn, consoleErr))
                {
                    Send(controlOut, challenge == null ? "L" : "V " + challenge);
                    return 2;
                }
                bool closed;
                Request request;
                lock (state.Gate)
                {
                    closed = state.Closed;
                    request = state.Pending;
                    state.Pending = null;
                }
                if (closed)
                {
                    Send(controlOut, challenge == null ? "L" : "V " + challenge);
                    return 2;
                }
                if (request != null)
                {
                    challenge = request.Challenge;
                    if (HasUnexpectedInput(consoleIn))
                    {
                        Send(controlOut, "U " + challenge);
                        return 2;
                    }
                    string prompt = (profileDisclosure ?? "") + request.Preview.Replace("\n", "\r\n") + "\r\nType DELETE " + challenge + " and press Enter (input is not echoed): ";
                    uint written;
#if OWNER_CONSOLE_TEST
                    if (BeforeWriteForTest != null) BeforeWriteForTest();
#endif
                    if (!WriteConsole(consoleErr, prompt, (uint)prompt.Length, out written, IntPtr.Zero) || written != prompt.Length || HasUnexpectedInput(consoleIn))
                    {
                        Send(controlOut, "U " + challenge);
                        return 2;
                    }
                }
                if (challenge == null || approved)
                {
                    if (HasUnexpectedInput(consoleIn))
                    {
                        Send(controlOut, challenge == null ? "L" : "V " + challenge);
                        return 2;
                    }
                }
                else
                {
                    InputRecord record;
                    int inspected = 0;
                    while (TryTakeInput(consoleIn, out record))
                    {
                        if (++inspected > MaxEventsPerScan) throw new IOException();
                        if (record.EventType != KeyEvent || record.KeyDown == 0) continue;
                        if ((record.ControlKeyState & DangerousModifiers) != 0 || record.RepeatCount != 1)
                        {
                            Send(controlOut, "D " + challenge);
                            return 2;
                        }
                        char c = record.UnicodeChar;
                        if (c == '\0') continue;
                        if (c == '\r')
                        {
                            if (HasUnexpectedInput(consoleIn) || answer != "DELETE " + challenge)
                            {
                                Send(controlOut, "D " + challenge);
                                return 2;
                            }
                            Send(controlOut, "A " + challenge);
                            approved = true;
                            break;
                        }
                        if (c < 0x20 || c > 0x7e || answer.Length >= 39)
                        {
                            Send(controlOut, "D " + challenge);
                            return 2;
                        }
                        answer += c;
                    }
                }
                // Reply only after this monitor loop has rechecked both handles
                // and confirmed the input queue has no unexpected record.
                lock (state.Gate)
                {
                    if (state.Closed) throw new IOException();
                    if (state.Probe != null)
                    {
#if OWNER_CONSOLE_TEST
                        if (BeforeProbeCheckForTest != null) BeforeProbeCheckForTest();
#endif
                        if (!ConsoleHealthy(consoleIn, consoleErr)) throw new IOException();
                        if (HasUnexpectedInput(consoleIn))
                        {
                            // A key may have arrived after the prompt scan. It is
                            // ordinary prompt input until an answer is accepted;
                            // process it before deciding whether the probe is healthy.
                            if (challenge == null || approved) throw new IOException();
                        }
                        else
                        {
                            Send(controlOut, "Z " + state.Probe);
                            state.Probe = null;
                        }
                    }
                }
                Thread.Sleep(PollMilliseconds);
            }
        }
        catch
        {
            try { Send(controlOut, challenge == null ? "L" : (approved ? "V " : "U ") + challenge); } catch { }
            return 2;
        }
    }

    private static bool ConsoleHealthy(IntPtr input, IntPtr error)
    {
        uint inputMode, errorMode;
        return input != IntPtr.Zero && error != IntPtr.Zero && GetConsoleMode(input, out inputMode) && GetConsoleMode(error, out errorMode);
    }

    // Discard only key-release records; no key-down or other event is consumed
    // while idle or after the answer. A remaining event fails the session.
    private static bool HasUnexpectedInput(IntPtr input)
    {
        InputRecord[] record = new InputRecord[1];
        int inspected = 0;
        while (true)
        {
            if (++inspected > MaxEventsPerScan) throw new IOException();
            uint count, read;
            if (!GetNumberOfConsoleInputEvents(input, out count)) throw new IOException();
            if (count == 0) return false;
            if (!PeekConsoleInput(input, record, 1, out read) || read != 1) throw new IOException();
            if (record[0].EventType != KeyEvent || record[0].KeyDown != 0) return true;
            if (!ReadConsoleInput(input, record, 1, out read) || read != 1) throw new IOException();
            if (record[0].EventType != KeyEvent || record[0].KeyDown != 0) return true;
        }
    }

    private static bool TryTakeInput(IntPtr input, out InputRecord record)
    {
        InputRecord[] records = new InputRecord[1];
        uint count, read;
        if (!GetNumberOfConsoleInputEvents(input, out count)) throw new IOException();
        if (count == 0) { record = new InputRecord(); return false; }
#if OWNER_CONSOLE_TEST
        if (BeforeInputReadForTest != null) BeforeInputReadForTest();
#endif
        if (!ReadConsoleInput(input, records, 1, out read) || read != 1) throw new IOException();
        record = records[0];
        if (record.EventType != KeyEvent) throw new IOException();
        return true;
    }

    private static void ReadControl(Stream input, Control state)
    {
        try
        {
            while (true)
            {
                byte[] header = ReadExactly(input, 4);
                uint size = (uint)(header[0] | (header[1] << 8) | (header[2] << 16) | (header[3] << 24));
                if (size == 0 || size > MaxFrame) throw new IOException();
                byte[] bytes = ReadExactly(input, (int)size);
                for (int i = 0; i < bytes.Length; i++) if (bytes[i] < 0x20 || bytes[i] > 0x7e) throw new IOException();
                string frame = Encoding.ASCII.GetString(bytes);
                lock (state.Gate)
                {
                    if (frame.StartsWith("T ", StringComparison.Ordinal))
                    {
                        string nonce = frame.Substring(2);
                        if (!IsHexNonce(nonce) || state.Probe != null || state.UsedNonces.Count >= MaxProbeNonces || !state.UsedNonces.Add(nonce)) throw new IOException();
                        state.Probe = nonce;
                    }
                    else
                    {
                        Request request = Parse(frame);
                        if (state.Received) throw new IOException();
                        state.Received = true;
                        state.Pending = request;
                    }
                }
            }
        }
        catch { lock (state.Gate) { state.Closed = true; } }
    }

    private static Request Parse(string frame)
    {
        string[] fields = frame.Split(' ');
        if (fields.Length != 3 || fields[0] != "R" || !IsHexNonce(fields[1])) throw new IOException();
        byte[] bytes = Convert.FromBase64String(fields[2]);
        if (bytes.Length == 0 || bytes.Length > MaxPreview || Convert.ToBase64String(bytes) != fields[2]) throw new IOException();
        foreach (byte b in bytes) if (b != 0x0a && (b < 0x20 || b > 0x7e)) throw new IOException();
        return new Request { Challenge = fields[1], Preview = Encoding.ASCII.GetString(bytes) };
    }

    private static bool IsHexNonce(string value)
    {
        if (value.Length != 32) return false;
        foreach (char c in value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }

    private static byte[] ReadExactly(Stream input, int length)
    {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int count = input.Read(bytes, offset, length - offset);
            if (count <= 0) throw new EndOfStreamException();
            offset += count;
        }
        return bytes;
    }

    private static void Send(Stream output, string message)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(message);
        byte[] header = { (byte)bytes.Length, (byte)(bytes.Length >> 8), (byte)(bytes.Length >> 16), (byte)(bytes.Length >> 24) };
        output.Write(header, 0, header.Length);
        output.Write(bytes, 0, bytes.Length);
        output.Flush();
    }
}
