using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Aegis.EtwProcess;

internal sealed record ProcessField(string Name, ushort Type);
internal sealed record ProcessPin(ushort Id, byte Version, byte Opcode, ushort Task, ProcessField[] Fields)
{
    internal string Fingerprint => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
        string.Join(";", Fields.Select(f => $"{f.Name}:{f.Type}")))));
}

// Source: installed Microsoft-Windows-Kernel-Process manifest, queried through
// EventMetadata.Template and independently checked with TDH before capture.
internal static class ProcessSchema
{
    internal static readonly Guid Provider = new("22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716");
    internal const ulong Keyword = 0x10;
    private static ProcessField F(string name, ushort type) => new(name, type);
    private static readonly ProcessField[] Start = [
        F("ProcessID", 8), F("ProcessSequenceNumber", 10), F("CreateTime", 17),
        F("ParentProcessID", 8), F("ParentProcessSequenceNumber", 10), F("SessionID", 8),
        F("Flags", 8), F("ProcessTokenElevationType", 8), F("ProcessTokenIsElevated", 8),
        F("MandatoryLabel", 19), F("ImageName", 1), F("ImageChecksum", 8),
        F("TimeDateStamp", 8), F("PackageFullName", 1), F("PackageRelativeAppId", 1),
        F("SecurityMitigations", 8)
    ];
    internal static readonly ProcessPin[] Pins = [
        new(1, 4, 1, 1, Start),
        new(2, 2, 2, 2, [
            F("ProcessID", 8), F("ProcessSequenceNumber", 10), F("CreateTime", 17),
            F("ExitTime", 17), F("ExitCode", 8), F("TokenElevationType", 8), F("HandleCount", 8),
            F("CommitCharge", 10), F("CommitPeak", 10), F("CPUCycleCount", 10),
            F("ReadOperationCount", 8), F("WriteOperationCount", 8), F("ReadTransferKiloBytes", 8),
            F("WriteTransferKiloBytes", 8), F("HardFaultCount", 8), F("ImageName", 2)
        ]),
        new(15, 2, 0, 15, Start)
    ];

    [StructLayout(LayoutKind.Sequential)]
    private struct Descriptor
    {
        public ushort Id; public byte Version, Channel, Level, Opcode; public ushort Task; public ulong Keyword;
    }
    [DllImport("tdh.dll")]
    private static extern uint TdhGetManifestEventInformation(in Guid provider, in Descriptor descriptor,
        IntPtr buffer, ref uint size);

    // TRACE_EVENT_INFO fixed header is 112 bytes; EVENT_PROPERTY_INFO is 24.
    // All selected properties are scalar, non-structured manifest data.
    internal static void VerifyInstalled()
    {
        if (!OperatingSystem.IsWindows() || IntPtr.Size != 8) throw new InvalidDataException("unsupported-host");
        foreach (var pin in Pins)
        {
            var descriptor = new Descriptor { Id = pin.Id, Version = pin.Version, Channel = 16,
                Level = 4, Opcode = pin.Opcode, Task = pin.Task, Keyword = 0x8000000000000010 };
            uint size = 0;
            if (TdhGetManifestEventInformation(in Provider, in descriptor, IntPtr.Zero, ref size) != 122 ||
                size < 112 || size > 65536) throw new InvalidDataException("provider-metadata-unavailable");
            var buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                if (TdhGetManifestEventInformation(in Provider, in descriptor, buffer, ref size) != 0)
                    throw new InvalidDataException("provider-metadata-unavailable");
                if (Marshal.PtrToStructure<Guid>(buffer) != Provider || Marshal.ReadInt32(buffer, 48) != 0 ||
                    Marshal.ReadInt16(buffer, 32) != pin.Id || Marshal.ReadByte(buffer, 34) != pin.Version ||
                    Marshal.ReadInt32(buffer, 100) != pin.Fields.Length ||
                    Marshal.ReadInt32(buffer, 104) != pin.Fields.Length ||
                    size < 112 + pin.Fields.Length * 24)
                    throw new InvalidDataException("provider-schema-mismatch");
                for (int i = 0; i < pin.Fields.Length; i++)
                {
                    int offset = 112 + i * 24;
                    int name = Marshal.ReadInt32(buffer, offset + 4);
                    if (Marshal.ReadInt32(buffer, offset) != 0 || name < 112 || name >= size - 1 ||
                        (name & 1) != 0 || Marshal.ReadInt16(buffer, offset + 8) != pin.Fields[i].Type ||
                        Marshal.ReadInt16(buffer, offset + 16) != 1)
                        throw new InvalidDataException("provider-schema-mismatch");
                    int end = name;
                    while (end < size - 1 && Marshal.ReadInt16(buffer, end) != 0) end += 2;
                    if (end >= size - 1 || Marshal.PtrToStringUni(buffer + name, (end - name) / 2) != pin.Fields[i].Name)
                        throw new InvalidDataException("provider-schema-mismatch");
                }
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }
}
