using System;
using System.IO;
using System.Web.Script.Serialization;

// Test-only executable. Every hook is fixed harmless file mutation, never a command.
internal static class ImportFixture
{
    private static bool Allowed(string seam)
    {
        return seam == "none" || seam == "swap" || seam == "content" || seam == "membership" ||
            seam == "ads" || seam == "hardlink" || seam == "fileid-unavailable" || seam == "upper-id" ||
            seam == "staged" || seam == "publication-fail" || seam == "pending" || seam == "enum-swap" ||
            seam == "retention" || seam == "writer-held" || seam == "collision" || seam == "size";
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode,
        SetLastError = true)]
    private static extern bool CreateHardLink(string newName, string existing, IntPtr security);

    private static void Mutate(ImportCapture captured, string source, string seam)
    {
        string selected = Path.Combine(source, "readme.txt");
        if (seam == "swap")
        {
            File.Move(selected, selected + ".old");
            File.Copy(selected + ".old", selected);
        }
        else if (seam == "content")
        {
            byte[] bytes = File.ReadAllBytes(selected); bytes[0] ^= 1; File.WriteAllBytes(selected, bytes);
        }
        else if (seam == "membership") File.WriteAllText(Path.Combine(source, "new.txt"), "dummy");
        else if (seam == "ads")
        {
            using (Microsoft.Win32.SafeHandles.SafeFileHandle streamHandle =
                ImportNative.Open(selected + ":hidden", ImportNative.Write, 1, 1))
            using (FileStream stream = new FileStream(streamHandle, FileAccess.Write)) stream.WriteByte(42);
        }
        else if (seam == "hardlink")
            ImportNative.Require(CreateHardLink(Path.Combine(Path.GetDirectoryName(source), "late-link.txt"),
                selected, IntPtr.Zero), "fixture-hardlink-failed");
        else if (seam == "upper-id") captured.Files[0].Identity.Id[15] ^= 1;
        else if (seam == "staged") ImportSeal.BeforeReadbackForTest = delegate(FileStream stream) {
            stream.Position = stream.Length - 1; int value = stream.ReadByte();
            stream.Position = stream.Length - 1; stream.WriteByte((byte)(value ^ 1)); stream.Flush(true);
        };
        else if (seam == "publication-fail") ImportSeal.PublicationFailure = true;
        else if (seam == "pending") ImportSeal.ForcePending = true;
        else if (seam == "size") File.AppendAllText(selected, "x");
        else if (seam == "writer-held") Writer = new FileStream(selected, FileMode.Open,
            FileAccess.ReadWrite, FileShare.Read);
        else if (seam == "retention") ImportSeal.BeforePublicationForTest = delegate {
            Denied(delegate { File.WriteAllText(selected, "changed"); });
            Denied(delegate { File.Delete(selected); });
            Denied(delegate { Directory.Move(source, source + ".moved"); });
        };
    }

    private static IDisposable Writer;
    private static void Denied(Action attempted)
    {
        bool denied = false;
        try { attempted(); }
        catch (IOException) { denied = true; }
        catch (UnauthorizedAccessException) { denied = true; }
        ImportNative.Require(denied, "fixture-retention-control-failed");
    }

    private static void Report(bool sealedResult, string code, ImportCapture captured, ImportSeal bundle)
    {
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            schemaVersion = 1, profile = ImportCapture.Profile,
            directoryStreamProfile = ImportNative.DirectoryStreamProfile,
            @sealed = sealedResult, code = code,
            developerOnly = true, launchAllowed = false, vmEffectsRun = false,
            guestImportQualified = false, nativeContainmentQualified = false, productionCaller = false,
            fileCount = captured == null ? 0 : captured.Files.Count,
            totalBytes = captured == null ? 0 : captured.TotalBytes,
            manifestSha256 = bundle == null ? null : bundle.ManifestHash,
            bundleSha256 = bundle == null ? null : bundle.BundleHash,
            bundleBytes = bundle == null ? 0 : bundle.BundleBytes, cleanup = ImportSeal.Cleanup
        }));
    }

    private static int Main(string[] args)
    {
        if (args.Length != 3 || !Allowed(args[2])) { Report(false, "fixture-options-invalid", null, null); return 2; }
        try
        {
            ImportNative.FileIdUnavailable = args[2] == "fileid-unavailable";
            ImportSeal.PendingPublication = delegate { Report(false, "import-publication-pending", null, null);
                Environment.Exit(2); };
            if (args[2] == "enum-swap") ImportCapture.BeforeOpenForTest = delegate(string selected) {
                if (Path.GetFileName(selected) != "readme.txt") return;
                ImportCapture.BeforeOpenForTest = null;
                File.Move(selected, Path.Combine(Path.GetDirectoryName(args[0]), "enumerated-old.txt"));
                File.Copy(Path.Combine(Path.GetDirectoryName(args[0]), "enumerated-old.txt"), selected);
            };
            using (ImportCapture captured = ImportCapture.Capture(args[0]))
            {
                Mutate(captured, args[0], args[2]);
                if (args[2] == "retention")
                {
                    Action sourceControls = ImportSeal.BeforePublicationForTest;
                    ImportSeal.BeforePublicationForTest = delegate {
                        sourceControls();
                        Denied(delegate { Directory.Move(args[1], args[1] + ".moved"); });
                    };
                }
                if (args[2] == "collision") ImportSeal.BeforePublicationForTest = delegate {
                    File.WriteAllText(Path.Combine(args[1], "bundle.aegis"), "DISPOSABLE_EXISTING_FINAL_CANARY");
                    Denied(delegate { Directory.Move(args[1], args[1] + ".moved"); });
                };
                using (ImportSeal bundle = ImportSeal.Seal(captured, args[1])) Report(true, "sealed", captured, bundle);
            }
            return 0;
        }
        catch (InvalidDataException error)
        {
            string code = error.Message;
            if (!code.StartsWith("import-") && !code.StartsWith("fixture-")) code = "import-unavailable";
            Report(false, code, null, null); return 2;
        }
        catch { Report(false, "import-unavailable", null, null); return 2; }
        finally { if (Writer != null) Writer.Dispose(); }
    }
}
