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
        var server = new Thread(delegate() {
            try
            {
                using (var peer = listener.AcceptTcpClient())
                using (var stream = peer.GetStream())
                {
                    peer.ReceiveTimeout = 3000; peer.SendTimeout = 3000;
                    int matched = 0;
                    for (int i = 0; i < 8192 && matched < 4; i++)
                    {
                        int next = stream.ReadByte(); if (next < 0) throw new IOException();
                        matched = next == "\r\n\r\n"[matched] ? matched + 1 : 0;
                    }
                    if (matched != 4) throw new IOException();
                    if (mode == "request-cancel") { Thread.Sleep(1500); serverPassed = true; return; }
                    int declared = mode == "wrong-length" ? 131073 : 131072;
                    string header = "HTTP/1.1 200 OK\r\nContent-Length: " + declared + "\r\nConnection: close\r\n\r\n";
                    byte[] headers = Encoding.ASCII.GetBytes(header); stream.Write(headers, 0, headers.Length); stream.Flush();
                    if (mode != "wrong-length")
                    {
                        var bytes = new byte[131072]; for (int i = 0; i < bytes.Length; i++) bytes[i] = 65;
                        int count = mode == "body-cancel" || mode == "short-eof" ? 65536 : bytes.Length;
                        stream.Write(bytes, 0, count); stream.Flush();
                        if (mode == "body-cancel") Thread.Sleep(1500);
                    }
                    serverPassed = true;
                }
            }
            catch { serverPassed = false; }
        });
        server.IsBackground = true; server.Start();
        string file = Path.Combine(root, mode + ".public");
        var observed = new CloudGuestMetadata.DownloadObservation(); bool completed = false;
        try
        {
            string digest = CloudGuestMetadata.Download("http://127.0.0.1:" + port + "/", file, 131072, observed);
            var bytes = new byte[131072]; for (int i = 0; i < bytes.Length; i++) bytes[i] = 65;
            using (var hash = SHA256.Create()) Require(digest == BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant());
            completed = true;
        }
        catch { Require(mode != "success"); }
        finally { Require(server.Join(4000)); listener.Stop(); }
        Require(serverPassed && completed == (mode == "success"));
        Require(observed.ExpectedBytes == 131072 && observed.ElapsedMilliseconds >= 0 && observed.ElapsedMilliseconds < 6000);
        if (mode == "request-cancel")
            Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Request && observed.DeadlineExpired && observed.ResponseStatusCode == 0 && observed.DeclaredBytes == -1 && observed.ReadCalls == 0 && observed.BytesRead == 0 && !File.Exists(file));
        else
        {
            Require(observed.ResponseStatusCode == 200 && observed.DeclaredBytes == (mode == "wrong-length" ? 131073 : 131072));
            if (mode == "wrong-length") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Response && observed.ReadCalls == 0 && observed.BytesWritten == 0 && !File.Exists(file));
            else
            {
                long expected = mode == "success" ? 131072 : 65536;
                Require(observed.BytesRead == expected && observed.BytesWritten == expected && observed.ReadCalls >= 2);
                Require(observed.LastReadMilliseconds >= 0 && observed.LastWriteMilliseconds >= 0 && observed.LastWriteMilliseconds <= observed.ElapsedMilliseconds);
                if (mode == "success") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Complete && !observed.DeadlineExpired);
                if (mode == "short-eof") Require(observed.Phase != CloudGuestMetadata.DownloadPhase.Complete && !observed.DeadlineExpired);
                if (mode == "body-cancel") Require(observed.Phase == CloudGuestMetadata.DownloadPhase.Read && observed.DeadlineExpired);
                // The actual downloader must have closed its output on failure.
                // Delete only this held, fixed disposable public file.
                using (var held = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 4096, FileOptions.DeleteOnClose)) Require(held.Length == expected);
                Require(!File.Exists(file));
            }
        }
        Console.WriteLine("media-fixture:" + mode + ";phase=" + observed.Phase + ";read=" + observed.BytesRead + ";written=" + observed.BytesWritten + ";deadline=" + observed.DeadlineExpired);
    }
    public static int Main(string[] args)
    {
        try
        {
            Require(args.Length == 1 && Directory.Exists(args[0]));
            foreach (string mode in new[] { "success", "wrong-length", "short-eof", "request-cancel", "body-cancel" }) Run(mode, args[0]);
            return 0;
        }
        catch { Console.Error.WriteLine("media-fixture-refused"); return 1; }
    }
}
