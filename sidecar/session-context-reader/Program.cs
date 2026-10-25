using System.Text.Json;
using Aegis.HookTransaction;
using Aegis.SessionContextReader;

// No argv, discovery, environment input, logging, generic action selector,
// reflection dispatch, writes, backups, IPC or application startup integration.
if (args.Length != 0 || !OperatingSystem.IsWindows()) return 1;
ReadLease? lease = null;
int expected = 1;
try
{
    var input = Console.OpenStandardInput();
    var output = Console.OpenStandardOutput();
    while (expected <= 32)
    {
        byte[]? bytes = Wire.Read(input);
        if (bytes is null) return 1;
        try
        {
            using var document = JsonDocument.Parse(bytes);
            var root = document.RootElement;
            int id = root.GetProperty("id").GetInt32();
            if (id != expected++) throw new InvalidDataException();
            string op = Wire.Text(root, "op", 8);
            switch (op)
            {
                case "open":
                case "tail":
                    Wire.Exact(root, "id", "op", "path");
                    if (lease is not null || id != 1) throw new InvalidDataException();
                    lease = ReadLease.Open(Wire.Text(root, "path", 240), op == "tail");
                    WriteStamp(id, lease.Stat(true));
                    break;
                case "stat":
                    Wire.Exact(root, "id", "op", "scope");
                    string scope = Wire.Text(root, "scope", 6);
                    if (scope is not ("path" or "handle") || lease is null)
                        throw new InvalidDataException();
                    WriteStamp(id, lease.Stat(scope == "path"));
                    break;
                case "read":
                    Wire.Exact(root, "id", "op", "length", "position");
                    if (lease is null) throw new InvalidDataException();
                    byte[] data = lease.Read(root.GetProperty("length").GetInt32(),
                        root.GetProperty("position").GetInt64());
                    try { Wire.Write(output, new { id, ok = true, data = Convert.ToBase64String(data) }); }
                    finally { Array.Clear(data); }
                    break;
                case "close":
                    Wire.Exact(root, "id", "op");
                    if (lease is null) throw new InvalidDataException();
                    lease.Dispose();
                    lease = null;
                    Wire.Write(output, new { id, ok = true, closed = true });
                    return 0;
                default: throw new InvalidDataException();
            }
        }
        finally { Array.Clear(bytes); }
    }

    void WriteStamp(int id, ReadLease.Stamp stamp) => Wire.Write(output, new {
        id, ok = true, kind = "regular", symlink = false, reparse = false,
        stamp.volumeId, stamp.fileId, stamp.size, stamp.mtimeNs, stamp.ctimeNs });
    return 1;
}
catch { return 1; }
finally { lease?.Dispose(); }
