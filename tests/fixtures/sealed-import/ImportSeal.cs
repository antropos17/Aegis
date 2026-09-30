using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal sealed class ImportSeal : IDisposable
{
    internal SafeFileHandle Handle;
    internal string ManifestHash, BundleHash;
    internal long BundleBytes;
    internal static string Cleanup = "not-created";
    internal static Action<FileStream> BeforeReadbackForTest;
    internal static bool PublicationFailure;
    internal static Action BeforePublicationForTest = null;
    internal static Action PendingPublication = null;
    internal static bool ForcePending = false;

    private static byte[] Manifest(ImportCapture captured)
    {
        List<object> files = new List<object>();
        long offset = 0;
        foreach (ImportCapture.CapturedFile file in captured.Files)
        {
            ImportNative.Require(ImportCapture.Hash(file.Bytes) == file.Hash, "import-staged-content-changed");
            files.Add(new { relativePath = file.Relative, size = file.Bytes.Length, sha256 = file.Hash, offset = offset });
            offset = checked(offset + file.Bytes.Length);
        }
        List<string> directories = new List<string>();
        foreach (ImportCapture.PinnedDirectory directory in captured.Directories)
            directories.Add(directory.Relative);
        string json = new JavaScriptSerializer { MaxJsonLength = ImportCapture.MaxManifestBytes }.Serialize(new {
            schemaVersion = 1, profile = ImportCapture.Profile, developerOnly = true, launchAllowed = false,
            directories = directories, files = files
        });
        byte[] bytes = new UTF8Encoding(false, true).GetBytes(json);
        ImportNative.Require(bytes.Length <= ImportCapture.MaxManifestBytes, "import-manifest-budget");
        return bytes;
    }

    private static List<SafeFileHandle> Reopen(ImportCapture captured)
    {
        List<SafeFileHandle> retained = new List<SafeFileHandle>();
        try
        {
            foreach (ImportCapture.CapturedFile file in captured.Files)
            {
                captured.Deadline();
                SafeFileHandle handle = ImportNative.Open(file.Path, ImportNative.Read, 1, 3);
                retained.Add(handle);
                ImportCapture.Stable(handle, file.Identity);
                byte[] current = ImportCapture.Read(handle, file.Identity.Size);
                try { ImportNative.Require(ImportCapture.Hash(current) == file.Hash, "import-content-changed"); }
                finally { Array.Clear(current, 0, current.Length); }
                ImportCapture.Stable(handle, file.Identity);
            }
            captured.CheckDirectories();
            return retained;
        }
        catch { foreach (SafeFileHandle handle in retained) handle.Dispose(); throw; }
    }

    internal static ImportSeal Seal(ImportCapture captured, string output)
    {
        Cleanup = "not-created";
        string[] components = ImportNative.ValidatePath(output);
        string parent = Path.GetDirectoryName(output);
        List<ImportCapture.PinnedDirectory> parents = ImportCapture.PinChain(parent);
        List<SafeFileHandle> sources = new List<SafeFileHandle>();
        SafeFileHandle stage = null;
        ImportNative.Identity stageIdentity = null;
        ImportCapture.PinnedDirectory owned = null;
        try
        {
            foreach (ImportCapture.PinnedDirectory ancestor in parents)
                foreach (ImportCapture.PinnedDirectory source in captured.Directories)
                    ImportNative.Require(!ImportNative.Same(ancestor.Identity, source.Identity), "import-output-overlap");
            ImportNative.Component(components[components.Length - 1], true);
            ImportNative.Require(ImportNative.CreateOwnedDirectory(output), "import-output-exists");
            Cleanup = "directory-retained";
            owned = ImportCapture.Pin(output, "");
            sources = Reopen(captured);
            byte[] manifest = Manifest(captured);
            string temporary = "stage-" + Guid.NewGuid().ToString("N") + ".tmp";
            stage = ImportNative.Open(Path.Combine(output, temporary),
                ImportNative.Read | ImportNative.Write | ImportNative.Delete, 1, 1);
            stageIdentity = ImportNative.Inspect(stage, false);
            ImportNative.NoStreams(stage, false);
            using (SafeFileHandle borrowed = new SafeFileHandle(stage.DangerousGetHandle(), false))
            using (FileStream stream = new FileStream(borrowed, FileAccess.ReadWrite, 4096, false))
            {
                byte[] magic = Encoding.ASCII.GetBytes("AEGSIM01");
                stream.Write(magic, 0, magic.Length);
                byte[] length = BitConverter.GetBytes(manifest.Length);
                stream.Write(length, 0, length.Length);
                byte[] payloadLength = BitConverter.GetBytes((int)captured.TotalBytes);
                stream.Write(payloadLength, 0, payloadLength.Length);
                stream.Write(manifest, 0, manifest.Length);
                foreach (ImportCapture.CapturedFile file in captured.Files) stream.Write(file.Bytes, 0, file.Bytes.Length);
                stream.Flush(true);
                ImportNative.Require(ImportNative.FlushFileBuffers(stage), "import-flush-failed");
                if (BeforeReadbackForTest != null) BeforeReadbackForTest(stream);
                byte[] actual = Readback(stream, manifest, captured);
                ImportCapture.Stable(owned.Handle, owned.Identity);
                ImportNative.Identity written = ImportNative.Inspect(stage, false);
                ImportNative.Require(ImportNative.Same(stageIdentity, written) && written.Size == actual.Length,
                    "import-staged-identity-changed");
                ImportNative.NoStreams(stage, false);
                foreach (ImportCapture.PinnedDirectory ancestor in parents)
                    ImportCapture.Stable(ancestor.Handle, ancestor.Identity);
                if (BeforePublicationForTest != null) BeforePublicationForTest();
                captured.Deadline();
                for (int index = 0; index < sources.Count; index++)
                    ImportCapture.Stable(sources[index], captured.Files[index].Identity);
                captured.CheckDirectories();
                Publish(stage, owned.Handle, "bundle.aegis");
                using (SafeFileHandle published = ImportNative.Open(Path.Combine(output, "bundle.aegis"), 0x80, 7, 3))
                    ImportNative.Require(ImportNative.Same(written, ImportNative.Inspect(published, false)),
                        "import-publication-identity-changed");
                Cleanup = "published-retained";
                ImportSeal result = new ImportSeal { Handle = stage, ManifestHash = ImportCapture.Hash(manifest),
                    BundleHash = ImportCapture.Hash(actual), BundleBytes = actual.Length };
                stage = null;
                Array.Clear(actual, 0, actual.Length);
                return result;
            }
        }
        catch
        {
            if (stage != null && stageIdentity != null)
            {
                try
                {
                    ImportCapture.Stable(owned.Handle, owned.Identity);
                    ImportNative.Require(ImportNative.Same(stageIdentity, ImportNative.Inspect(stage, false)),
                        "import-cleanup-identity-changed");
                    IntPtr disposition = Marshal.AllocHGlobal(1);
                    try
                    {
                        Marshal.WriteByte(disposition, 1);
                        Cleanup = ImportNative.SetFileInformationByHandle(stage, 4, disposition, 1)
                            ? "stage-removed" : "stage-retained-uncertain";
                    }
                    finally { Marshal.FreeHGlobal(disposition); }
                }
                catch { Cleanup = "stage-retained-uncertain"; }
            }
            throw;
        }
        finally
        {
            if (stage != null) stage.Dispose();
            if (owned != null) owned.Handle.Dispose();
            foreach (SafeFileHandle handle in sources) handle.Dispose();
            for (int index = parents.Count - 1; index >= 0; index--) parents[index].Handle.Dispose();
        }
    }

    private static byte[] Readback(FileStream stream, byte[] manifest, ImportCapture captured)
    {
        long expected = checked(16 + manifest.Length + captured.TotalBytes);
        ImportNative.Require(stream.Length == expected && expected <= 16 + 65536 + 1048576,
            "import-staged-size-changed");
        byte[] actual = new byte[(int)expected];
        stream.Position = 0;
        int total = 0;
        while (total < actual.Length)
        {
            int count = stream.Read(actual, total, actual.Length - total);
            ImportNative.Require(count > 0, "import-staged-short-read");
            total += count;
        }
        ImportNative.Require(stream.ReadByte() == -1 && Encoding.ASCII.GetString(actual, 0, 8) == "AEGSIM01" &&
            BitConverter.ToInt32(actual, 8) == manifest.Length &&
            BitConverter.ToInt32(actual, 12) == captured.TotalBytes, "import-staged-header-changed");
        byte[] observedManifest = new byte[manifest.Length];
        Array.Copy(actual, 16, observedManifest, 0, manifest.Length);
        ImportNative.Require(ImportNative.Equal(manifest, observedManifest), "import-staged-manifest-changed");
        int offset = 16 + manifest.Length;
        foreach (ImportCapture.CapturedFile file in captured.Files)
        {
            byte[] bytes = new byte[file.Bytes.Length];
            Array.Copy(actual, offset, bytes, 0, bytes.Length);
            try { ImportNative.Require(ImportCapture.Hash(bytes) == file.Hash, "import-staged-content-changed"); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
            offset = checked(offset + bytes.Length);
        }
        ImportNative.Require(offset == actual.Length, "import-staged-size-changed");
        return actual;
    }

    private static void Publish(SafeFileHandle file, SafeFileHandle parent, string name)
    {
        byte[] filename = Encoding.Unicode.GetBytes(name + "\0");
        // sizeof(FILE_RENAME_INFORMATION) is 24 on x64; FileName starts at 20.
        // kernel32's relative-root wrapper returned ERROR_INVALID_PARAMETER on
        // the measured runtime. NtSetInformationFile preserves handle-relative naming.
        int size = 24 + filename.Length;
        IntPtr information = Marshal.AllocHGlobal(size);
        IntPtr ioStatus = Marshal.AllocHGlobal(16);
        bool parentReference = false;
        try
        {
            ImportNative.Require(IntPtr.Size == 8 && Marshal.SizeOf(typeof(ImportNative.IoStatus)) == 16,
                "import-native-layout-unavailable");
            Marshal.Copy(new byte[size], 0, information, size);
            Marshal.Copy(new byte[16], 0, ioStatus, 16);
            parent.DangerousAddRef(ref parentReference);
            Marshal.WriteIntPtr(information, 8, parent.DangerousGetHandle());
            Marshal.WriteInt32(information, 16, filename.Length - 2);
            Marshal.Copy(filename, 0, IntPtr.Add(information, 20), filename.Length);
            ImportNative.Require(!PublicationFailure, "import-publication-failed");
            int status = ForcePending ? 0x103 :
                ImportNative.NtSetInformationFile(file, ioStatus, information, (uint)size, 10);
            ImportNative.IoStatus completion = (ImportNative.IoStatus)Marshal.PtrToStructure(ioStatus,
                typeof(ImportNative.IoStatus));
            if (status == 0x103 || completion.Status == new IntPtr(0x103))
            {
                // Unresolved IO must not unwind and free either native buffer.
                // The fixed fixture exits failed; process teardown owns cancellation.
                Cleanup = "stage-retained-uncertain";
                if (PendingPublication != null) PendingPublication();
                Environment.Exit(2);
            }
            ImportNative.Require(status == 0 && completion.Status == IntPtr.Zero &&
                completion.Information == UIntPtr.Zero, "import-publication-failed");
        }
        finally
        {
            if (parentReference) parent.DangerousRelease();
            Marshal.FreeHGlobal(ioStatus); Marshal.FreeHGlobal(information);
        }
    }

    public void Dispose() { if (Handle != null) { Handle.Dispose(); Handle = null; } }
}
