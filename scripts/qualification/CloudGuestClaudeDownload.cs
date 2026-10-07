using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;

// Exact public binary only, downloaded on the disposable hosted runner.
public static class CloudGuestClaudeDownload
{
    public static string Download(string destination)
    {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows") throw new InvalidOperationException("claude-cloud-download-required");
        if (!Path.IsPathRooted(destination) || Path.GetFileName(destination) != "claude.exe" || File.Exists(destination))
            throw new InvalidOperationException("claude-download-path-refused");
        for (DirectoryInfo entry = new DirectoryInfo(Path.GetDirectoryName(destination)); entry != null; entry = entry.Parent)
            if (!entry.Exists || (entry.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("claude-download-path-refused");
        const long length = 254858400;
        const string expected = "eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23";
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(2)))
        using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
        using (var client = new HttpClient(handler))
        using (var response = client.GetAsync("https://downloads.claude.ai/claude-code-releases/2.1.292/win32-x64/claude.exe", HttpCompletionOption.ResponseHeadersRead, cancellation.Token).GetAwaiter().GetResult())
        {
            if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentLength != length) throw new InvalidOperationException("claude-download-size-refused");
            using (var source = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var hash = SHA256.Create())
            {
                byte[] buffer = new byte[65536]; long received = 0;
                while (true)
                {
                    int count = source.ReadAsync(buffer, 0, buffer.Length, cancellation.Token).GetAwaiter().GetResult();
                    if (count == 0) break;
                    received += count;
                    if (received > length || new DriveInfo(Path.GetPathRoot(destination)).AvailableFreeSpace < 10737418240L)
                        throw new InvalidOperationException("claude-download-budget-refused");
                    output.Write(buffer, 0, count); hash.TransformBlock(buffer, 0, count, null, 0);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                string digest = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                if (received != length || digest != expected) throw new InvalidOperationException("claude-download-pin-refused");
                return digest;
            }
        }
    }
}
