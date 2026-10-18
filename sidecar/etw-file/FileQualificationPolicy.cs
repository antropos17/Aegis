namespace Aegis.EtwLifecycle;

// Qualification-only launch authority: one fixed image, one fixture tree, no ETW commands.
internal static class FileQualificationPolicy
{
    internal const string Variable = "AEGIS_ETW_QUALIFICATION_HOST";
    private static bool PipeId(string value) => Guid.TryParseExact(value, "N", out var id) && id != Guid.Empty && id.ToString("N") == value;
    internal static bool Collector(string mode) => mode is "collector" or "crash-collector" or "prestart-collector" or
        "prearm-collector" or "guard-loss-collector" or "dual-guard-collector" or "dual-collector" or
        "dual-prearm-collector" or "dual-prestart-collector" or "triple-collector" or "triple-guard-collector" or
        "triple-fallback-collector" or "triple-prearm-collector" or "triple-prestart-collector" or "group-parent-collector" or
        "orphan-prestart-collector" or "orphan-prearm-collector" or "orphan-main-collector" or "orphan-native-collector" or
        "orphan-denial-collector" or "custodian-exit-collector";

    internal static void Validate(string[] args, string root, int clientPid, ulong clientBirth)
    {
        if (args.Any(v => v == null || v.Length > 1024 || v.Any(char.IsControl))) throw new InvalidDataException();
        if (args.Length == 4 && args[0] == "recover-peer")
        {
            if (!PipeId(args[1]) || args[2] != clientPid.ToString() || args[3] != clientBirth.ToString())
                throw new UnauthorizedAccessException();
            return;
        }
        if (args.Length != 11 || !Collector(args[0]) || !FileWire.Id(args[1]) || !FileWire.Id(args[2]) ||
            !PipeId(args[3]) || args[4] != clientPid.ToString() || args[5] != clientBirth.ToString() ||
            args[7] != FileWire.Profile || !PipeId(args[8]) || !PipeId(args[9]) || args[10] != "orphan-custody")
            throw new UnauthorizedAccessException();
        string fixture = new FileScope(args[6], false).Root;
        string boundary = new FileScope(root, false).Root;
        if (!fixture.StartsWith(boundary + "\\", StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
    }

    internal static void OrdinaryDirectory(string root)
    {
        _ = new FileScope(root);
        for (var directory = new DirectoryInfo(root); directory != null; directory = directory.Parent)
            if (!directory.Exists || directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new UnauthorizedAccessException();
    }
}
