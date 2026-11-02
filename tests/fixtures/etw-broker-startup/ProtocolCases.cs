using System.Text.Json;
using static BrokerStartupFixture.BrokerSession;

namespace BrokerStartupFixture;

internal static class ProtocolCases
{
    internal static async Task Identities(bool second)
    {
        int goodPid = second ? FallbackPid : PrimaryPid;
        string goodBirth = second ? "456" : "123";
        var invalid = new List<object>();
        foreach (int pid in new[] { 0, -1, BrokerPid, CollectorPid }.Concat(second ? [PrimaryPid] : Array.Empty<int>()))
            invalid.Add(new { pid, birth = goodBirth, guid = Reservation });
        foreach (string? birth in new[] { "0", "01", "-1", "+123", " 123", "18446744073709551616", null })
            invalid.Add(new { pid = goodPid, birth, guid = Reservation });
        foreach (string? guid in new[] { "", new string('0', 32), Reservation.ToUpperInvariant(),
            "12345678-1234-1234-1234-1234567890ab", null })
            invalid.Add(new { pid = goodPid, birth = goodBirth, guid });
        foreach (object hello in invalid)
        {
            await using var session = await BrokerSession.Create();
            var run = session.Run();
            if (second) { await session.Hello(); await session.Ack(); }
            await session.Json(hello); await Error<InvalidDataException>(run); await session.NoAck();
            Require(session.PrimaryCalls == (second ? 1 : 0) && session.FallbackCalls == 0,
                "invalid identity reached native boundary");
        }
    }

    internal static async Task MismatchedReservation()
    {
        await using var session = await BrokerSession.Create();
        var run = session.Run(); await session.Hello(); await session.Ack();
        await session.Json(new { pid = FallbackPid, birth = "456", guid = "123456781234123412341234567890ac" });
        await Error<InvalidDataException>(run); await session.NoAck();
        Require(session.FallbackCalls == 0, "mismatched reservation reached fallback");
    }

    internal static async Task Frames(bool second)
    {
        int pid = second ? FallbackPid : PrimaryPid;
        string birth = second ? "456" : "123";
        string good = JsonSerializer.Serialize(new { pid, birth, guid = Reservation });
        string[] invalid =
        [
            "{", "[]", good[..^1] + ",\"extra\":true}",
            good[..^1] + ",\"pid\":" + pid + "}",
            JsonSerializer.Serialize(new { pid, birth }),
            JsonSerializer.Serialize(new { pid, birth = 123, guid = Reservation }),
            JsonSerializer.Serialize(new { pid = "300", birth, guid = Reservation })
        ];
        foreach (string json in invalid)
        {
            await using var session = await BrokerSession.Create();
            var run = session.Run();
            if (second) { await session.Hello(); await session.Ack(); }
            await session.Raw(json);
            try { await run.WaitAsync(Limit); throw new InvalidOperationException("accepted malformed frame"); }
            catch (Exception error) when (error is InvalidDataException or JsonException) { }
            await session.NoAck();
            Require(session.PrimaryCalls == (second ? 1 : 0) && session.FallbackCalls == 0,
                "malformed frame reached native boundary");
        }
        foreach (int length in new[] { 0, -1, 2049 })
        {
            await using var session = await BrokerSession.Create();
            var run = session.Run();
            if (second) { await session.Hello(); await session.Ack(); }
            await session.Frame([], length); await Error<InvalidDataException>(run); await session.NoAck();
        }
    }

    internal static async Task BudgetBounds()
    {
        foreach (TimeSpan budget in new[] { TimeSpan.Zero, TimeSpan.FromMilliseconds(-1), TimeSpan.FromMilliseconds(8001) })
        {
            await using var session = await BrokerSession.Create();
            await Error<ArgumentOutOfRangeException>(session.Run(budget: budget));
            Require(session.PrimaryCalls == 0 && session.FallbackCalls == 0, "invalid budget reached native boundary");
        }
    }
}
