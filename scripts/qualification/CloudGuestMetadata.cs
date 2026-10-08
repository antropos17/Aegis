using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// Qualification-only media readers. Never mount, apply, or service a guest image.
public static class CloudGuestMetadata
{
    [DllImport("wimgapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr WIMCreateFile(string path, uint access, uint disposition, uint flags, uint compression, out uint result);
    [DllImport("wimgapi.dll", SetLastError = true)]
    private static extern bool WIMGetImageInformation(IntPtr image, out IntPtr data, out uint bytes);
    [DllImport("wimgapi.dll")] private static extern bool WIMCloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr handle);
    private static void Require(bool value, string stage)
    { if (!value) throw new InvalidDataException(stage); }
    public static string ImageXml(string path)
    {
        IntPtr handle = IntPtr.Zero, data = IntPtr.Zero;
        try
        {
            uint result, bytes;
            handle = WIMCreateFile(path, 0x80000000, 3, 0, 0, out result);
            Require(handle != IntPtr.Zero && handle != new IntPtr(-1), "wim-read-open-failed");
            Require(WIMGetImageInformation(handle, out data, out bytes), "wim-metadata-read-failed");
            Require(data != IntPtr.Zero && bytes >= 2 && bytes <= 1048576 && bytes % 2 == 0, "wim-metadata-budget-failed");
            return Marshal.PtrToStringUni(data, checked((int)bytes / 2)).TrimEnd('\0');
        }
        finally
        {
            if (data != IntPtr.Zero) LocalFree(data);
            if (handle != IntPtr.Zero && handle != new IntPtr(-1)) WIMCloseHandle(handle);
        }
    }
    public static long CopyIso(object source, string destination)
    {
        var stream = (IStream)source;
        System.Runtime.InteropServices.ComTypes.STATSTG information;
        stream.Stat(out information, 1);
        Require(information.cbSize > 0 && information.cbSize <= 16777216, "answer-iso-budget-failed");
        IntPtr received = Marshal.AllocHGlobal(4);
        try
        {
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[65536]; long written = 0;
                while (written < information.cbSize)
                {
                    int requested = (int)Math.Min(buffer.Length, information.cbSize - written);
                    Marshal.WriteInt32(received, 0);
                    stream.Read(buffer, requested, received);
                    int count = Marshal.ReadInt32(received);
                    Require(count > 0 && count <= requested, "answer-iso-stream-failed");
                    output.Write(buffer, 0, count); written += count;
                }
                output.Flush(); return written;
            }
        }
        finally { Marshal.FreeHGlobal(received); }
    }
    public enum DownloadPhase { NotStarted, Request, Response, StreamOpen, FileOpen, Read, Write, Hash, Headroom, Finalize, Flush, Close, Complete }
    // Fixed scalar observations only; no remote text, URL, headers or file paths.
    public sealed class DownloadObservation
    {
        public DownloadPhase Phase { get; internal set; }
        public int ResponseStatusCode { get; internal set; }
        public long ExpectedBytes { get; internal set; }
        public long DeclaredBytes { get; internal set; }
        public long BytesRead { get; internal set; }
        public long BytesWritten { get; internal set; }
        public long ReadCalls { get; internal set; }
        public long ElapsedMilliseconds { get; internal set; }
        public long LastReadMilliseconds { get; internal set; }
        public long LastWriteMilliseconds { get; internal set; }
        public bool DeadlineExpired { get; internal set; }
    }
    public static string Download(string url, string destination, long expectedBytes)
    { return Download(url, destination, expectedBytes, new DownloadObservation()); }
    public static string Download(string url, string destination, long expectedBytes, DownloadObservation observation)
    {
        Require(expectedBytes == 8225329152L && url == "https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso", "fixed-media-source-required");
        Require(observation != null && observation.Phase == DownloadPhase.NotStarted, "fresh-media-observation-required");
        observation.ExpectedBytes = expectedBytes; observation.DeclaredBytes = -1;
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var watch = System.Diagnostics.Stopwatch.StartNew();
        using (var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(20)))
        {
            try
            {
                string downloadedDigest;
                observation.Phase = DownloadPhase.Request;
                using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
                using (var client = new HttpClient(handler))
                using (var response = client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellation.Token).GetAwaiter().GetResult())
                {
                    observation.Phase = DownloadPhase.Response;
                    observation.ResponseStatusCode = (int)response.StatusCode;
                    observation.DeclaredBytes = response.Content.Headers.ContentLength ?? -1;
                    Require(response.StatusCode == HttpStatusCode.OK && response.Content.Headers.ContentLength == expectedBytes, "media-http-length-failed");
                    observation.Phase = DownloadPhase.StreamOpen;
                    using (var source = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                    {
                        observation.Phase = DownloadPhase.FileOpen;
                        using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        using (var digest = SHA256.Create())
                        {
                            var buffer = new byte[65536]; long written = 0, checkedAt = 0;
                            while (true)
                            {
                                observation.Phase = DownloadPhase.Read; observation.ReadCalls++;
                                int count = source.ReadAsync(buffer, 0, buffer.Length, cancellation.Token).GetAwaiter().GetResult();
                                observation.BytesRead += count; observation.LastReadMilliseconds = watch.ElapsedMilliseconds;
                                if (count == 0) break;
                                Require(written + count <= expectedBytes, "media-byte-budget-failed");
                                observation.Phase = DownloadPhase.Write;
                                output.Write(buffer, 0, count); written += count;
                                observation.BytesWritten = written; observation.LastWriteMilliseconds = watch.ElapsedMilliseconds;
                                observation.Phase = DownloadPhase.Hash;
                                digest.TransformBlock(buffer, 0, count, null, 0);
                                if (written - checkedAt >= 67108864)
                                {
                                    observation.Phase = DownloadPhase.Headroom;
                                    Require(new DriveInfo(Path.GetPathRoot(destination)).AvailableFreeSpace > 10737418240L, "media-disk-headroom-failed");
                                    checkedAt = written;
                                }
                            }
                            observation.Phase = DownloadPhase.Finalize;
                            Require(written == expectedBytes, "media-download-incomplete");
                            digest.TransformFinalBlock(new byte[0], 0, 0);
                            observation.Phase = DownloadPhase.Flush; output.Flush();
                            downloadedDigest = BitConverter.ToString(digest.Hash).Replace("-", "").ToLowerInvariant();
                            observation.Phase = DownloadPhase.Close;
                        }
                    }
                }
                observation.Phase = DownloadPhase.Complete;
                return downloadedDigest;
            }
            finally
            { observation.ElapsedMilliseconds = watch.ElapsedMilliseconds; observation.DeadlineExpired = cancellation.IsCancellationRequested; }
        }
    }
}
