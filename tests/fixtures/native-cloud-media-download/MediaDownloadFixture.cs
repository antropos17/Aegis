using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// Disposable loopback/public bytes. The harness substitutes only the fixed
// source admission and deadline in a generated copy of the real downloader.
public static class MediaDownloadFixture
{
    private static void Require(bool value) { if (!value) throw new InvalidDataException("media-fixture-refused"); }
    private static TcpListener callerListener;
    private static Thread callerThread;
    private static bool callerPassed;
    public static string PrepareCallerCancellation()
    {
        Require(callerListener == null);
        callerListener = new TcpListener(IPAddress.Loopback, 0); callerListener.Start();
        int port = ((IPEndPoint)callerListener.LocalEndpoint).Port;
        callerThread = new Thread(delegate() {
            try
            {
                using (var peer = callerListener.AcceptTcpClient())
                using (var stream = peer.GetStream())
                {
                    peer.ReceiveTimeout = 3000; peer.SendTimeout = 3000; int matched = 0;
                    for (int i = 0; i < 8192 && matched < 4; i++)
                    {
                        int next = stream.ReadByte(); if (next < 0) throw new IOException();
                        matched = next == "\r\n\r\n"[matched] ? matched + 1 : 0;
                    }
                    Require(matched == 4);
                    byte[] headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 131072\r\nConnection: close\r\n\r\n");
                    stream.Write(headers, 0, headers.Length);
                    var bytes = new byte[65536]; for (int i = 0; i < bytes.Length; i++) bytes[i] = 65;
                    stream.Write(bytes, 0, bytes.Length); stream.Flush(); Thread.Sleep(1500); callerPassed = true;
                }
            }
            catch { callerPassed = false; }
        });
        callerThread.IsBackground = true; callerThread.Start();
        return "http://127.0.0.1:" + port + "/";
    }
    public static void CompleteCallerCancellation()
    {
        bool joined = callerThread.Join(4000); callerListener.Stop();
        Require(joined && callerPassed);
    }
    private static void Run(string mode, string root)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        bool serverPassed = false;
        int requests = 0;
        bool resumed = mode == "resume" || mode == "resume-ignored" || mode == "bad-range" || mode == "changed-entity";
        int expectedRequests = mode == "short-eof" ? 4 : resumed ? 2 : 1;
        long serverWritten = 0;
        var server = new Thread(delegate() {
            try
            {
                for (int attempt = 0; attempt < expectedRequests; attempt++)
                {
                    using (var peer = listener.AcceptTcpClient())
                    using (var stream = peer.GetStream())
                    {
                        requests++; peer.ReceiveTimeout = 3000; peer.SendTimeout = 3000;
                        var input = new StringBuilder(); int matched = 0;
                        for (int i = 0; i < 8192 && matched < 4; i++)
                        {
                            int next = stream.ReadByte(); if (next < 0) throw new IOException();
                            input.Append((char)next);
                            matched = next == "\r\n\r\n"[matched] ? matched + 1 : 0;
                        }
                        Require(matched == 4);
                        if (attempt == 0) Require(!input.ToString().Contains("Range:"));
                        else
                        {
                            Require(input.ToString().Contains("Range: bytes=" + serverWritten + "-"));
                            Require(input.ToString().Contains("If-Range: \"fixed\""));
                        }
                        if (mode == "request-cancel") { Thread.Sleep(1500); continue; }
                        bool invalidResume = attempt > 0 && (mode == "resume-ignored" || mode == "bad-range" || mode == "changed-entity");
                        long declared = mode == "wrong-length" ? 131073 : attempt == 0 || mode == "resume-ignored" ? 131072 : 131072 - serverWritten;
                        string status = attempt == 0 || mode == "resume-ignored" ? "200 OK" : "206 Partial Content";
                        string range = attempt == 0 || mode == "resume-ignored" ? "" : "Content-Range: bytes " + (mode == "bad-range" ? serverWritten - 1 : serverWritten) + "-131071/131072\r\n";
                        string tag = mode == "changed-entity" && attempt > 0 ? "changed" : "fixed";
                        string header = "HTTP/1.1 " + status + "\r\nContent-Length: " + declared + "\r\nETag: \"" + tag + "\"\r\n" + range + "Connection: close\r\n\r\n";
                        byte[] headers = Encoding.ASCII.GetBytes(header); stream.Write(headers, 0, headers.Length); stream.Flush();
                        if (mode != "wrong-length" && !invalidResume)
                        {
                            var bytes = new byte[131072]; for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)(mode == "wrong-hash" ? 66 : 65);
                            int count = (int)declared;
                            if (mode == "body-cancel" || mode == "short-eof" || (resumed && attempt == 0)) count /= 2;
                            stream.Write(bytes, 0, count); stream.Flush(); serverWritten += count;
                            if (mode == "body-cancel") Thread.Sleep(1500);
                        }
                    }
                }
                serverPassed = true;
            }
            catch { serverPassed = false; }
        });
        server.IsBackground = true; server.Start();
        string file = Path.Combine(root, mode + ".public"), partial = file + ".partial";
        var observed = new CloudGuestMetadata.DownloadObservation(); bool completed = false;
        bool shouldComplete = mode == "success" || mode == "resume";
        try
        {
            string digest = CloudGuestMetadata.Download("http://127.0.0.1:" + port + "/", file, 131072, observed);
            var bytes = new byte[131072]; for (int i = 0; i < bytes.Length; i++) bytes[i] = 65;
            using (var hash = SHA256.Create()) Require(digest == BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant());
            completed = true;
        }
        catch { Require(!shouldComplete); }
        finally { bool joined = server.Join(4000); listener.Stop(); Require(joined); }
        Require(serverPassed && completed == shouldComplete && requests == expectedRequests && observed.RequestCount == expectedRequests);
        Require(observed.ExpectedBytes == 131072 && observed.ElapsedMilliseconds >= 0 && observed.ElapsedMilliseconds < 6000);
        Require(observed.IntegrityVerified == shouldComplete && observed.Promoted == shouldComplete);
        Require(File.Exists(file) == shouldComplete && File.Exists(partial) == (serverWritten != 0 && !shouldComplete));
        if (mode == "request-cancel")
            Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Request && observed.DeadlineExpired && observed.ResponseStatusCode == 0 && observed.DeclaredBytes == -1 && observed.ReadCalls == 0 && observed.BytesRead == 0);
        else if (mode == "wrong-length") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Response && observed.ReadCalls == 0 && observed.BytesWritten == 0 && observed.TransientFailures == 0);
        else
        {
            Require(observed.BytesRead == serverWritten && observed.BytesWritten == serverWritten && observed.ReadCalls >= 2);
            Require(observed.LastReadMilliseconds >= 0 && observed.LastWriteMilliseconds >= 0 && observed.LastWriteMilliseconds <= observed.ElapsedMilliseconds);
            if (shouldComplete) Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Complete && !observed.DeadlineExpired);
            if (mode == "body-cancel") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Read && observed.DeadlineExpired && observed.TransientFailures == 0);
            if (mode == "wrong-hash") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Finalize && observed.TransientFailures == 0);
            if (resumed) Require(observed.ResumeRequests == 1 && observed.TransientFailures == 1);
            if (mode == "short-eof") Require(observed.ResumeRequests == 3 && observed.TransientFailures == 3 && !observed.DeadlineExpired);
            // The final name must expose only verified bytes; an unsuccessful
            // download retains a closed, bounded partial owned by this fixture.
            string heldPath = shouldComplete ? file : partial;
            using (var held = new FileStream(heldPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 4096, FileOptions.DeleteOnClose)) Require(held.Length == serverWritten);
            Require(!File.Exists(heldPath));
        }
        Console.WriteLine("media-fixture:" + mode + ";phase=" + observed.Phase + ";requests=" + observed.RequestCount + ";resumes=" + observed.ResumeRequests + ";written=" + observed.BytesWritten + ";verified=" + observed.IntegrityVerified + ";promoted=" + observed.Promoted + ";deadline=" + observed.DeadlineExpired);
    }
    public static int Main(string[] args)
    {
        try
        {
            Require(args.Length == 1 && Directory.Exists(args[0]));
            foreach (string mode in new[] { "success", "wrong-length", "short-eof", "request-cancel", "body-cancel", "resume", "resume-ignored", "bad-range", "changed-entity", "wrong-hash" }) Run(mode, args[0]);
            return 0;
        }
        catch (Exception failure) { Console.Error.WriteLine("media-fixture-refused:" + failure.GetType().Name); return 1; }
    }
}
