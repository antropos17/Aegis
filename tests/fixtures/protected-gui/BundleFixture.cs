using System;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class BundleFixture
{
    private static void Main(string[] args)
    {
        try
        {
            if (args[0] == "production")
            {
                Need(typeof(ProtectedGuiBundleFiles).GetMethod("ModelProtectionForTest") == null && typeof(ProtectedGuiIdentity).GetMethod("CreateForTest") == null &&
                    typeof(ProtectedGuiIdentity).GetMethod("CheckPairForTest") == null);
                Console.WriteLine("{\"passed\":true,\"testFactories\":false}"); return;
            }
#if PROTECTED_GUI_TEST
            if (args[0] == "identity") { Identity(); Console.WriteLine("{\"passed\":true,\"modeledPrincipal\":true}"); return; }
            if (args[0] == "rename-probe") { RenameProbe(args[1], args[2]); Console.WriteLine("{\"passed\":true,\"continuousOriginal\":true}"); return; }
#endif
            string mode = args.Length > 2 ? args[2] : "capture";
            if (mode == "capture")
            {
                bool refused = false;
                try { using (var source = ProtectedGuiBundleFiles.Capture(args[0], File.ReadAllBytes(args[1]))) { source.CheckCurrent(); } }
                catch (InvalidDataException) { refused = true; }
                Console.WriteLine("{\"refused\":" + (refused ? "true" : "false") + "}"); return;
            }
#if PROTECTED_GUI_TEST
            Stage(args[0], args[1], mode, args[3]);
            Console.WriteLine("{\"passed\":true,\"nativeFiles\":true,\"modeledProtection\":true,\"guiLaunched\":false}");
#else
            throw new InvalidOperationException("fixture-production-mode");
#endif
        }
        catch (Exception failure)
        {
            Console.Error.WriteLine(failure.GetType().Name + ":" + failure.Message + ":" + failure.StackTrace);
            Exception observed = failure;
            for (int depth = 0; observed != null && depth < 4; depth++, observed = observed.InnerException) {
                if (observed.Data["protectedOperation"] is String) Console.Error.WriteLine("protectedOperation=" + observed.Data["protectedOperation"]);
                foreach (string field in new[] { "protectedNativeNtStatus", "protectedNativeWin32", "protectedGuiEntryType" })
                    if (observed.Data[field] is Int32) Console.Error.WriteLine(field + "=" + (Int32)observed.Data[field]);
            }
            Environment.ExitCode = 1;
        }
    }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("fixture-assertion"); }
#if PROTECTED_GUI_TEST
    private static void Identity()
    {
        string sid = WindowsIdentity.GetCurrent().User.Value;
        Need(ProtectedGuiIdentity.CheckPairForTest(sid, sid, 1, 1, 2, 3, "S-1-16-12288", "S-1-16-8192"));
        Need(!ProtectedGuiIdentity.CheckPairForTest(sid, "S-1-5-18", 1, 1, 2, 3, "S-1-16-12288", "S-1-16-8192"));
        Need(!ProtectedGuiIdentity.CheckPairForTest(sid, sid, 1, 2, 2, 3, "S-1-16-12288", "S-1-16-8192"));
        Need(!ProtectedGuiIdentity.CheckPairForTest(sid, sid, 0, 0, 2, 3, "S-1-16-12288", "S-1-16-8192"));
        Need(!ProtectedGuiIdentity.CheckPairForTest(sid, sid, 1, 1, 3, 2, "S-1-16-12288", "S-1-16-8192"));
        Need(!ProtectedGuiIdentity.CheckPairForTest(sid, sid, 1, 1, 2, 3, "S-1-16-12288", "S-1-16-12288"));
        Need(ProtectedGuiIdentity.SameForTest("token", "auth", "high", "changed"));
        Need(!ProtectedGuiIdentity.SameForTest("replacement", "auth", "high", "changed"));
        Need(!ProtectedGuiIdentity.SameForTest("token", "other-auth", "high", "changed"));
        Need(!ProtectedGuiIdentity.SameForTest("token", "auth", "medium", "changed"));
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle ReOpenFile(SafeFileHandle original, uint access, uint share, uint flags);
    [StructLayout(LayoutKind.Sequential)] private struct FileIdentifier { internal uint Size, Type; internal ulong Low, High; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenFileById(SafeFileHandle hint, ref FileIdentifier identity, uint access, uint share, IntPtr security, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] value, uint length);
    private static string ProbeId(SafeFileHandle file)
    { byte[] value = new byte[24]; Need(GetFileInformationByHandleEx(file, 18, value, 24)); return BitConverter.ToString(value); }
    private static void RenameProbe(string work, string mode)
    {
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        using (var parent = new ProtectedInstallFile(work, true, false))
        using (var stage = ProtectedInstallFile.CreateDirectory(Path.Combine(work, "stage"), acl.GetSecurityDescriptorBinaryForm()))
        {
            if (mode == "empty") { stage.Rename(Path.Combine(work, "published"), parent); return; }
            if (mode == "by-id")
            {
                string path = Path.Combine(stage.PathName, "file"); byte[] identity = new byte[24];
                using (var original = CreateFile(path, 0xc0030000, 5, IntPtr.Zero, 1, 0x00200000, IntPtr.Zero))
                    Need(!original.IsInvalid && GetFileInformationByHandleEx(original, 18, identity, 24));
                using (var hint = CreateFile(work, 0x20080, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
                {
                    Need(!hint.IsInvalid); byte[] parentId = new byte[24]; Need(GetFileInformationByHandleEx(hint, 18, parentId, 24));
                    Need(BitConverter.ToUInt64(parentId, 0).ToString("x16") == parent.Volume && BitConverter.ToString(parentId, 8).Replace("-", "").ToLowerInvariant() == parent.FileId);
                    stage.Rename(Path.Combine(work, "published"), parent);
                    var descriptor = new FileIdentifier { Size = 24, Type = 2, Low = BitConverter.ToUInt64(identity, 8), High = BitConverter.ToUInt64(identity, 16) };
                    using (var resumed = OpenFileById(hint, ref descriptor, 0x80030080, 5, IntPtr.Zero, 0x00200000))
                    {
                        if (resumed.IsInvalid) { Console.Error.WriteLine("openFileByIdWin32=" + Marshal.GetLastWin32Error()); Need(false); }
                        Need(ProbeId(resumed) == BitConverter.ToString(identity));
                    }
                }
                return;
            }
            if (mode == "directory")
            {
                using (var childDirectory = ProtectedInstallFile.CreateDirectory(Path.Combine(stage.PathName, "child"), acl.GetSecurityDescriptorBinaryForm()))
                    stage.Rename(Path.Combine(work, "published"), parent);
                return;
            }
            string child = Path.Combine(stage.PathName, "file"); SafeFileHandle metadata = null;
            using (var original = CreateFile(child, 0xc0030000, 5, IntPtr.Zero, 1, 0x00200000, IntPtr.Zero))
            {
                Need(!original.IsInvalid); string identity = ProbeId(original);
                metadata = ReOpenFile(original, Convert.ToUInt32(mode, 16), 7, 0x00200000); Need(!metadata.IsInvalid && ProbeId(metadata) == identity);
            }
            using (metadata)
            {
                string identity = ProbeId(metadata);
                stage.Rename(Path.Combine(work, "published"), parent); Need(ProbeId(metadata) == identity);
            }
        }
    }
    private static void Stage(string sourcePath, string manifestPath, string mode, string work)
    {
        ProtectedGuiBundleFiles.ModelProtectionForTest();
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        byte[] descriptor = acl.GetSecurityDescriptorBinaryForm();
        using (var parent = new ProtectedInstallFile(work, true, false))
        using (var stage = ProtectedInstallFile.CreateDirectory(Path.Combine(work, "stage"), descriptor))
        using (var source = ProtectedGuiBundleFiles.Capture(sourcePath, File.ReadAllBytes(manifestPath)))
        using (var principal = ProtectedGuiIdentity.CreateForTest(WindowsIdentity.GetCurrent().User.Value, 1))
        {
            if (mode == "partial")
            {
                ProtectedGuiBundleNative.FailCopyForTest = true; bool refused = false;
                try { source.Stage(stage, descriptor, parent, principal); } catch (InvalidDataException) { refused = true; }
                Need(refused && !Directory.Exists(Path.Combine(stage.PathName, "GuiBundle"))); stage.Delete(); return;
            }
            using (var bundle = source.Stage(stage, descriptor, parent, principal))
            {
                bundle.CheckCurrent(stage); Need(bundle.FileCount == 2 && bundle.TotalBytes > 0);
                bool writeRefused = false;
                try { File.WriteAllText(Path.Combine(stage.PathName, "GuiBundle", ProtectedGuiManifest.ProductExecutable), "changed"); }
                catch (IOException) { writeRefused = true; }
                Need(writeRefused); bundle.CheckCurrent(stage);
                if (mode == "rename")
                {
                    bundle.RenameStage(stage, parent, Path.Combine(work, "published")); bundle.CheckCurrent(stage);
                    bundle.RenameStage(stage, parent, Path.Combine(work, "rollback")); bundle.CheckCurrent(stage);
                }
                else if (mode == "wrong-parent")
                {
                    using (var imported = new ProtectedInstallFile(work, true, false))
                    {
                        bool refused = false; try { bundle.RenameStage(stage, imported, Path.Combine(work, "published")); }
                        catch (InvalidDataException) { refused = true; }
                        Need(refused && stage.PathName == Path.Combine(work, "stage")); bundle.CheckCurrent(stage);
                    }
                }
                else if (mode == "wrong-principal")
                {
                    using (var next = ProtectedInstallFile.CreateDirectory(Path.Combine(work, "next"), descriptor))
                    using (var imported = ProtectedGuiIdentity.CreateForTest(WindowsIdentity.GetCurrent().User.Value, 1))
                    {
                        bool refused = false; try { bundle.Stage(next, descriptor, parent, imported); } catch (InvalidDataException) { refused = true; }
                        Need(refused && !Directory.Exists(Path.Combine(next.PathName, "GuiBundle"))); next.Delete();
                    }
                }
                else if (mode == "stopped-principal")
                {
                    principal.Dispose(); bool refused = false; try { bundle.RenameStage(stage, parent, Path.Combine(work, "published")); }
                    catch (InvalidDataException) { refused = true; }
                    Need(refused && stage.PathName == Path.Combine(work, "stage")); bundle.CheckCurrent(stage);
                }
                else if (mode == "clone")
                {
                    using (var next = ProtectedInstallFile.CreateDirectory(Path.Combine(work, "next"), descriptor))
                    using (var clone = bundle.Stage(next, descriptor, parent, principal))
                    {
                        bundle.Remove(stage); clone.CheckCurrent(next); clone.Remove(next); next.Delete();
                    }
                    stage.Delete(); return;
                }
                else if (mode == "foreign")
                {
                    string canary = Path.Combine(stage.PathName, "GuiBundle", "foreign.canary"); File.WriteAllText(canary, "untouched");
                    bool unknown = false;
                    try { bundle.Remove(stage); } catch (InvalidDataException failure) { unknown = failure.Data.Contains("protectedCleanupUnknown"); }
                    Need(unknown && File.ReadAllText(canary) == "untouched" && File.Exists(Path.Combine(stage.PathName, "GuiBundle", ProtectedGuiManifest.ProductExecutable)));
                    return;
                }
                else if (mode == "delete-link-replace" || mode == "delete-link-readonly")
                {
                    bundle.RenameStage(stage, parent, Path.Combine(work, "published")); bundle.CheckCurrent(stage);
                    ProtectedGuiBundleNative.ReplaceDeleteLinkForTest = mode == "delete-link-replace";
                    ProtectedGuiBundleNative.ReadOnlyDeleteLinkForTest = mode == "delete-link-readonly";
                    bool unknown = false; try { bundle.Remove(stage); }
                    catch (InvalidDataException failure) { unknown = failure.Data.Contains("protectedCleanupUnknown"); }
                    string first = Path.Combine(stage.PathName, "GuiBundle", "resources", "app.asar");
                    Need(unknown && File.Exists(first) && File.Exists(Path.Combine(stage.PathName, "GuiBundle", ProtectedGuiManifest.ProductExecutable)));
                    if (mode == "delete-link-replace") {
                        Need(File.ReadAllText(first) == "foreign-delete-link" && File.Exists(first + ".original"));
                        using (var input = new FileStream(first + ".original", FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        using (var reader = new StreamReader(input)) Need(reader.ReadToEnd() == "dummy-asar");
                    } else {
                        Need((File.GetAttributes(first) & FileAttributes.ReadOnly) != 0); File.SetAttributes(first, FileAttributes.Normal);
                    }
                    bool refused = false; try { bundle.CheckCurrent(stage); } catch (InvalidDataException) { refused = true; } Need(refused);
                    refused = false; try { bundle.Remove(stage); } catch (InvalidDataException failure) { refused = failure.Data.Contains("protectedCleanupUnknown"); } Need(refused);
                    return;
                }
                else if (mode.StartsWith("rename-", StringComparison.Ordinal))
                {
                    string action = mode.Substring(7); ProtectedGuiBundleFiles.SetRenameFailureForTest(action); bool unknown = false;
                    try { bundle.RenameStage(stage, parent, Path.Combine(work, "published")); }
                    catch (InvalidDataException failure) { unknown = failure.Data.Contains("protectedCleanupUnknown"); }
                    Need(unknown && stage.PathName == Path.Combine(work, "published"));
                    bool refused = false; try { bundle.CheckCurrent(stage); } catch (InvalidDataException) { refused = true; } Need(refused);
                    refused = false; try { bundle.Remove(stage); } catch (InvalidDataException failure) { refused = failure.Data.Contains("protectedCleanupUnknown"); } Need(refused);
                    if (action == "replace") Need(File.ReadAllText(Path.Combine(stage.PathName, "GuiBundle", ProtectedGuiManifest.ProductExecutable)) == "foreign-replacement");
                    if (action == "extra") Need(File.ReadAllText(Path.Combine(stage.PathName, "GuiBundle", "foreign.canary")) == "untouched");
                    if (action == "acl") {
                        bool changed = false;
                        foreach (FileSystemAccessRule rule in File.GetAccessControl(Path.Combine(stage.PathName, "GuiBundle", ProtectedGuiManifest.ProductExecutable)).GetAccessRules(true, true, typeof(SecurityIdentifier)))
                            if (rule.IdentityReference.Value == "S-1-1-0" && rule.AccessControlType == AccessControlType.Allow &&
                                (rule.FileSystemRights & FileSystemRights.Write) != 0) changed = true;
                        Need(changed);
                    }
                    return;
                }
                else if (mode != "stage") throw new InvalidOperationException("fixture-stage-mode");
                bundle.Remove(stage); Need(!Directory.Exists(Path.Combine(stage.PathName, "GuiBundle")));
            }
            stage.Delete();
        }
    }
#endif
}
