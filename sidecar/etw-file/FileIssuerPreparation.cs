using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record FileIssuerTarget(uint pid, string createTime100ns);
internal sealed record FileIssuerRequest(string requestId, FileIssuerTarget[] issuers)
{
    internal static FileIssuerRequest Parse(JsonElement data)
    {
        FileWire.Shape(data, "requestId", "issuers");
        string request = data.GetProperty("requestId").GetString() ?? "";
        var values = data.GetProperty("issuers");
        if (!FileWire.Id(request) || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 16)
            throw new InvalidDataException();
        var result = new List<FileIssuerTarget>();
        var seen = new HashSet<uint>();
        foreach (var value in values.EnumerateArray())
        {
            FileWire.Shape(value, "pid", "createTime100ns");
            uint pid = value.GetProperty("pid").GetUInt32();
            string birth = value.GetProperty("createTime100ns").GetString() ?? "";
            if (pid is 0 or uint.MaxValue || !seen.Add(pid) ||
                !ulong.TryParse(birth, out ulong time) || time == 0 || time.ToString() != birth)
                throw new InvalidDataException();
            result.Add(new(pid, birth));
        }
        return new(request, result.ToArray());
    }
}
internal sealed record FilePreparedIssuer(uint pid, string createTime100ns, int threads);
internal sealed record FileIssuerPreparation(string requestId, FilePreparedIssuer[] prepared, string asOfQpc);
