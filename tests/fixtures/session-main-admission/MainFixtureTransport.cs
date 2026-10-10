using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class MainFixtureTransport
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, SafeFileHandle source, SafeFileHandle targetProcess,
        out IntPtr target, uint access, bool inherit, uint options);
    internal static IntPtr DuplicateTo(SafeFileHandle source, SafeFileHandle target, uint access)
    {
        IntPtr result;
        CallerNative.Require(DuplicateHandle(new IntPtr(-1), source, target, out result, access, false, 0));
        return result;
    }
    internal static void Until(Func<bool> condition)
    {
        var timer = Stopwatch.StartNew();
        while (!condition()) { CallerNative.Require(timer.ElapsedMilliseconds < 5000); Thread.Sleep(2); }
    }
    internal static void Save(string target, string value)
    { File.WriteAllText(target + ".tmp", value, new UTF8Encoding(false)); File.Move(target + ".tmp", target); }
    internal static void WriteRecords(string root, string mode)
    {
        CompositionFiles.WriteRecord(root, Path.Combine(root, "aegis-session.exe"));
        string inventory = "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1,\"epoch\":\"" + new string('b', 32) +
            "\",\"selections\":[{\"id\":\"" + new string('c', 32) + "\",\"epoch\":\"" + new string('d', 32) + "\",\"operation\":\"inspect-owned\"}]}";
        if (mode == "duplicate-selection") inventory = inventory.Replace("}]}", "},{\"id\":\"" + new string('c', 32) +
            "\",\"epoch\":\"" + new string('f', 32) + "\",\"operation\":\"inspect-owned\"}]}");
        File.WriteAllText(Path.Combine(root, "inventory.json"), inventory, new UTF8Encoding(false));
        string main = Path.Combine(root, "aegis-main.exe");
        CallerIdentity operatorIdentity;
        using (var current = Process.GetCurrentProcess())
        using (var held = CallerNative.Duplicate(current.Handle))
        using (var token = CallerNative.ProcessToken(held)) operatorIdentity = CallerIdentity.Observe(token);
        string role = "{\"schemaVersion\":1,\"installId\":\"" + new string('a', 32) + "\",\"revision\":1,\"epoch\":\"" + new string('b', 32) +
            "\",\"role\":\"controller-main\",\"protocol\":\"aegis-supervisor-caller\",\"protocolVersion\":1," +
            "\"operatorSid\":\"" + operatorIdentity.OperatorSid + "\",\"operatorAuthentication\":\"" + operatorIdentity.OperatorAuthentication +
            "\",\"operatorSession\":" + operatorIdentity.OperatorSession + ",\"mainImageSize\":" + new FileInfo(main).Length +
            ",\"mainImageSha256\":\"" + CompositionFiles.Hash(main) + "\",\"inventorySha256\":\"" + CompositionFiles.Hash(Path.Combine(root, "inventory.json")) + "\"}";
        if (mode == "role-protocol") role = role.Replace("aegis-supervisor-caller", "aegis-observed-caller");
        if (mode == "role-epoch") role = role.Replace(new string('b', 32), new string('f', 32));
        if (mode == "role-image") role = role.Replace(CompositionFiles.Hash(main), new string('f', 64));
        if (mode == "role-inventory") role = role.Replace(CompositionFiles.Hash(Path.Combine(root, "inventory.json")), new string('f', 64));
        if (mode == "operator-sid") role = role.Replace(operatorIdentity.OperatorSid, operatorIdentity.OperatorSid == "S-1-5-18" ? "S-1-5-19" : "S-1-5-18");
        if (mode == "operator-authentication") role = role.Replace(operatorIdentity.OperatorAuthentication, new string('f', 16));
        if (mode == "operator-session") role = role.Replace("\"operatorSession\":" + operatorIdentity.OperatorSession,
            "\"operatorSession\":" + (operatorIdentity.OperatorSession + 1));
        File.WriteAllText(Path.Combine(root, "main-registration.json"), role, new UTF8Encoding(false));
    }
}
