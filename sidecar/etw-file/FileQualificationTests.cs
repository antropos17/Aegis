namespace Aegis.EtwLifecycle;

internal static class FileQualificationTests
{
    internal static void Run(Action<string, Action> test)
    {
        string id = "12345678123456781234567812345678";
        string[] capture = ["collector", id, id, id, "71", "1000", @"C:\lab\case\fixture", FileWire.Profile, id, id, "orphan-custody"];
        void Validate(string[] args) => FileQualificationPolicy.Validate(args, @"C:\lab", 71, 1000);
        test("qualification launch authority rejects arbitrary commands, roots and identity substitution", () =>
        {
            Validate(capture); Validate(["recover-peer", id, "71", "1000"]);
            foreach (int index in new[] { 0, 3, 4, 5, 6, 7, 10 })
            {
                var value = (string[])capture.Clone(); value[index] = index == 6 ? @"C:\laboratory\outside" : "foreign";
                Reject(() => Validate(value));
            }
            Reject(() => Validate(["cmd.exe", "/c", "anything"]));
            Reject(() => Validate(["recover-peer", id, "72", "1000"]));
            Reject(() => Validate(capture[..10]));
            var traversal = (string[])capture.Clone(); traversal[6] = @"C:\lab\..\outside";
            Reject(() => Validate(traversal));
        });
        test("qualification host permits only the existing bounded collector modes", () =>
        {
            foreach (string mode in new[] { "orphan-main-collector", "custodian-exit-collector", "triple-prestart-collector" })
            { var value = (string[])capture.Clone(); value[0] = mode; Validate(value); }
            foreach (string mode in new[] { "custodian", "rescue", "inspect-elevated", "self-test", "check-collector" })
            { var value = (string[])capture.Clone(); value[0] = mode; Reject(() => Validate(value)); }
        });
    }
    private static void Reject(Action action) { bool rejected = false; try { action(); } catch { rejected = true; } if (!rejected) throw new InvalidOperationException(); }
}
