using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

internal static class Protocol
{
    internal const int RequestMaximum = 8 * 1024 * 1024 + 65536 + 1024;
    internal const int ReplyMaximum = 8192;

    internal static byte[] ReadRequest(nint pipe)
    {
        byte[] header = Exact(pipe, 4);
        uint length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        Native.Check(length > 0 && length <= RequestMaximum);
        byte[] body = Exact(pipe, checked((int)length));
        byte[] framed = new byte[body.Length + 4];
        header.CopyTo(framed, 0); body.CopyTo(framed, 4);
        return framed;
    }

    private static byte[] Exact(nint pipe, int length)
    {
        byte[] result = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            Program.CheckRunning();
            Native.Check(Native.PeekNamedPipe(pipe, 0, 0, 0, out uint available, 0));
            if (available == 0) { Thread.Sleep(2); continue; }
            byte[] chunk = new byte[Math.Min(length - offset, Math.Min(available, 16384))];
            Native.Check(Native.ReadFile(pipe, chunk, (uint)chunk.Length, out uint count, 0) && count > 0);
            chunk.AsSpan(0, checked((int)count)).CopyTo(result.AsSpan(offset));
            offset += checked((int)count);
        }
        return result;
    }

    internal static void Send(nint pipe, byte[] frame)
    {
        int offset = 0;
        while (offset < frame.Length)
        {
            Program.CheckRunning();
            byte[] chunk = frame.AsSpan(offset, Math.Min(4096, frame.Length - offset)).ToArray();
            // A dedicated native watchdog terminates the Job if a child blocks this write.
            Native.Check(Native.WriteFile(pipe, chunk, (uint)chunk.Length, out uint written, 0) && written > 0);
            offset += checked((int)written);
        }
    }

    // EOF is only ERROR_BROKEN_PIPE. Other pipe failures are unknown and refuse.
    private static bool Drain(nint pipe, MemoryStream output, bool discard)
    {
        if (!Native.PeekNamedPipe(pipe, 0, 0, 0, out uint available, 0))
        {
            Native.Check(Marshal.GetLastWin32Error() == 109);
            return true;
        }
        if (available == 0) return false;
        byte[] chunk = new byte[Math.Min(available, 4096)];
        Native.Check(Native.ReadFile(pipe, chunk, (uint)chunk.Length, out uint count, 0) && count > 0);
        Native.Check(output.Length + count <= ReplyMaximum);
        if (discard) throw new InvalidOperationException("cedar-child-diagnostics");
        output.Write(chunk, 0, checked((int)count));
#if CEDAR_JOB_FIXTURE
        if (Fixture.PipeOnly) Fixture.AfterOutputRead();
#endif
        return false;
    }

    private static uint WaitChild(Child child)
    {
#if CEDAR_JOB_FIXTURE
        if (Fixture.PipeOnly) return 0; // Explicit synthetic process state; native pipes only.
#endif
        return Native.WaitForSingleObject(child.Process, 0);
    }

    private static bool CleanChildExit(Child child)
    {
#if CEDAR_JOB_FIXTURE
        if (Fixture.PipeOnly) return true;
#endif
        return Native.GetExitCodeProcess(child.Process, out uint code) && code == 0;
    }

    private static void CheckControlCutoff()
    {
        nint control = Native.GetStdHandle(-10);
#if CEDAR_JOB_FIXTURE
        if (Fixture.PipeOnly) control = Fixture.ControlPipe;
#endif
        if (!Native.PeekNamedPipe(control, 0, 0, 0, out uint available, 0) || available != 0)
            throw new InvalidOperationException("cedar-control-refused");
    }

    internal static JsonElement Receive(Child child)
    {
        using var output = new MemoryStream();
        using var error = new MemoryStream();
        bool outputClosed = false, errorClosed = false;
        while (WaitChild(child) == 258)
        {
            Program.CheckRunning();
            outputClosed = Drain(child.Output, output, false);
            errorClosed = Drain(child.Error, error, true);
            CheckControlCutoff();
            Thread.Sleep(2);
        }
        Native.Check(WaitChild(child) == 0);
        // Keep the original process and Job handles until both private pipes prove EOF.
        var drain = Stopwatch.StartNew();
        while ((!outputClosed || !errorClosed) && drain.ElapsedMilliseconds < 250)
        {
            outputClosed = outputClosed || Drain(child.Output, output, false);
            errorClosed = errorClosed || Drain(child.Error, error, true);
            Thread.Sleep(2);
        }
        Native.Check(outputClosed && errorClosed);
        Native.Check(CleanChildExit(child));
        byte[] bytes = output.ToArray();
        Native.Check(bytes.Length >= 5 && BinaryPrimitives.ReadUInt32LittleEndian(bytes) == bytes.Length - 4);
        using var document = JsonDocument.Parse(bytes.AsMemory(4), new JsonDocumentOptions { MaxDepth = 8 });
        var value = document.RootElement;
        ExactKeys(value, "decision", "reason", "policyIds");
        string? decision = value.GetProperty("decision").GetString(), reason = value.GetProperty("reason").GetString();
        Native.Check(decision is "allow" or "ask" or "deny");
        Native.Check(reason is "policy-allow" or "policy-ask" or "review-required" or "policy-deny" or "request-invalid" or "policy-invalid" or "cedar-unavailable" or "cedar-evaluation-failed");
        var ids = value.GetProperty("policyIds");
        Native.Check(ids.ValueKind == JsonValueKind.Array && ids.GetArrayLength() <= 33);
        foreach (var id in ids.EnumerateArray())
        {
            string? text = id.GetString();
            Native.Check(text is { Length: > 0 and <= 64 } && char.IsAsciiLetter(text[0]) && text.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'));
        }
        // Last observed control cutoff, after final drain/exit/metadata checks.
        // This refuses already queued bytes/known pipe loss, not future arrivals.
        CheckControlCutoff();
        return value.Clone();
    }

    internal static bool DrainAfterStop(Child child)
    {
#if CEDAR_JOB_FIXTURE
        if (Program.FixtureFault == "unknown-pipe") return false;
#endif
        var timer = Stopwatch.StartNew();
        bool outputClosed = false, errorClosed = false;
        int total = 0;
        while (timer.ElapsedMilliseconds < 250)
        {
            foreach (nint pipe in new[] { child.Output, child.Error })
            {
                if (!Native.PeekNamedPipe(pipe, 0, 0, 0, out uint available, 0))
                {
                    if (Marshal.GetLastWin32Error() != 109) return false;
                    if (pipe == child.Output) outputClosed = true; else errorClosed = true;
                    continue;
                }
                if (available == 0) continue;
                byte[] chunk = new byte[Math.Min(available, 4096)];
                if (!Native.ReadFile(pipe, chunk, (uint)chunk.Length, out uint count, 0) || count == 0) return false;
                total += checked((int)count);
                if (total > ReplyMaximum) return false;
            }
            if (outputClosed && errorClosed) return true;
            Thread.Sleep(2);
        }
        return false;
    }

    internal static void ExactKeys(JsonElement value, params string[] keys)
    {
        Native.Check(value.ValueKind == JsonValueKind.Object && value.EnumerateObject().Count() == keys.Length);
        Native.Check(keys.All(key => value.TryGetProperty(key, out _)));
    }

    internal static void Write(Stream stream, object value)
    {
        byte[] body = JsonSerializer.SerializeToUtf8Bytes(value);
        Native.Check(body.Length <= ReplyMaximum);
        byte[] header = new byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)body.Length);
        stream.Write(header); stream.Write(body); stream.Flush();
    }
}
