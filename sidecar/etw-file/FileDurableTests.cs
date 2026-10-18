using System.Text;
using System.Text.Json;
using System.Security.AccessControl;
using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileDurableTests
{
    private static FileDurableLease Lease() => new(1, "12345678123456781234567812345678", "user", "logon", "image",
        Enumerable.Range(71, 6).Select(pid => new FileDurablePeer(pid, "134000000000001111")).ToArray());
    internal static void Run(Action<string, Action> test)
    {
        test("durable recovery covers all six original identities without a survivor", () =>
        {
            int calls = 0;
            var result = FileDurableRecovery.Recover(Lease(), _ => true, guid =>
            {
                Check(guid == Lease().guid); calls++; return new("recovered", true, true, null, null);
            });
            Check(calls == 1 && result.stopped && result.absent);
        });
        test("durable recovery refuses each live or unobservable original identity", () =>
        {
            for (int i = 71; i <= 76; i++) foreach (bool? state in new bool?[] { false, null })
            {
                var result = FileDurableRecovery.Recover(Lease(), peer => peer.pid == i ? state : true,
                    _ => throw new InvalidOperationException("must-not-control"));
                Check(!result.stopped && !result.absent);
            }
        });
        test("durable recovery preserves actual denied control without retiring the reservation", () =>
        {
            var result = FileDurableRecovery.Recover(Lease(), _ => true,
                _ => new("unverified", false, false, new(5, null, null, null, null, null), null));
            Check(result.counters?.Status == 5 && !result.stopped && !result.absent);
        });
        test("durable journal rejects malformed, duplicate and incomplete authority", () =>
        {
            var valid = JsonSerializer.SerializeToUtf8Bytes(Lease());
            Check(FileDurableRecovery.Parse(valid).peers.Length == 6);
            foreach (var lease in new[] { Lease() with { version = 2 }, Lease() with { guid = new('0', 32) },
                Lease() with { peers = Lease().peers.Take(5).ToArray() },
                Lease() with { peers = Enumerable.Repeat(Lease().peers[0], 6).ToArray() },
                Lease() with { peers = [.. Lease().peers.Take(5), new(88, "0134000000000001111")] } })
                Reject(() => FileDurableRecovery.Parse(JsonSerializer.SerializeToUtf8Bytes(lease)));
            Reject(() => FileDurableRecovery.Parse(new byte[8193]));
            Reject(() => FileDurableRecovery.Parse(Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(valid).Replace("\"version\":1", "\"version\":1,\"version\":1"))));
            Reject(() => FileDurableRecovery.Parse(Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(valid).Replace("\"pid\":71", "\"pid\":71,\"pid\":72"))));
        });
        test("durable journal requires a protected administrator-owned exact DACL", () =>
        {
            bool Safe(string sddl)
            {
                var descriptor = new RawSecurityDescriptor(sddl);
                byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
                return FileDurableJournal.SafeDescriptor(bytes);
            }
            Check(Safe("O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)"));
            foreach (var sddl in new[] { "O:BAG:BAD:(A;;KA;;;SY)(A;;KA;;;BA)", "O:BUG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)",
                "O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BU)", "O:BAG:BAD:P(A;;KA;;;BA)(A;;KA;;;BA)",
                "O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KR;;;WD)" }) Check(!Safe(sddl));
        });
        test("stale foreign-scope metadata needs independent absence and six proved exits", () =>
        {
            Check(FileDurableRecovery.Retirable(Lease(), 4201, _ => true));
            foreach (uint status in new uint[] { 0, 5, 6, 87, 50 })
                Check(!FileDurableRecovery.Retirable(Lease(), status, _ => true));
            Check(!FileDurableRecovery.Retirable(Lease(), 4201, p => p.pid == 71 ? false : true));
            Check(!FileDurableRecovery.Retirable(Lease(), 4201, p => p.pid == 76 ? null : true));
        });
        test("durable PID reuse compares full births and never terminates the replacement", () =>
        {
            using var child = Process.Start(Program.Child("lease-test-child")) ?? throw new IOException();
            using var handle = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, child.Id);
            ulong birth = FileMainHandles.Birth(handle);
            Check(FileDurableRecovery.Gone(new(child.Id, birth.ToString())) == false);
            Check(FileDurableRecovery.Gone(new(child.Id, (birth - 1).ToString())) == true && !child.HasExited);
            child.StandardInput.WriteLine("finish"); child.StandardInput.Flush();
            Check(child.WaitForExit(8000) && child.ExitCode == 77);
            Check(FileDurableRecovery.Gone(new(child.Id, birth.ToString())) == true);
        });
    }
    private static void Reject(Action body) { bool rejected = false; try { body(); } catch { rejected = true; } Check(rejected); }
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("check-failed"); }
}
