using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;

internal static class AppContainerProbe
{
    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    private static string Read(string path)
    {
        try { return File.ReadAllText(path).Trim() == "AEGIS_PRIVATE_SENTINEL" ? "secret-leaked" : "other-content"; }
        catch (Exception error) { return error.GetType().Name; }
    }
    private static string Write(string path)
    {
        try { File.WriteAllText(path, "AEGIS_PRIVATE_WRITE"); return "write-succeeded"; }
        catch (Exception error) { return error.GetType().Name; }
    }
    private static string Connect(int port)
    {
        using (TcpClient client = new TcpClient())
        {
            try
            {
                IAsyncResult pending = client.BeginConnect("127.0.0.1", port, null, null);
                if (!pending.AsyncWaitHandle.WaitOne(1200)) return "timeout";
                client.EndConnect(pending);
                return "connected";
            }
            catch (SocketException error) { return "socket-" + (int)error.SocketErrorCode; }
            catch (Exception error) { return error.GetType().Name; }
        }
    }
    private static int Main(string[] args)
    {
        if (args.Length < 2) return 3;
        string mode = args[0], privateFile = args[1], cwd = Environment.CurrentDirectory;
        if (mode == "hang")
        {
            File.WriteAllText(Path.Combine(cwd, "running.txt"), Process.GetCurrentProcess().Id.ToString());
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }
        if (mode == "child")
        {
            File.WriteAllText(Path.Combine(cwd, "child.txt"),
                "pid=" + Process.GetCurrentProcess().Id + "\nread=" + Read(privateFile) +
                "\nwrite=" + Write(privateFile + ".child") +
                "\nimport=" + Read(Path.Combine(cwd, "input.bin")));
            return 0;
        }
        if (mode != "evidence" || args.Length != 3) return 4;
        int port;
        if (!int.TryParse(args[2], out port)) return 5;
        File.WriteAllText(Path.Combine(cwd, "parent.txt"),
            "pid=" + Process.GetCurrentProcess().Id + "\nread=" + Read(privateFile) +
            "\nwrite=" + Write(privateFile + ".parent") + "\nnetwork=" + Connect(port) +
            "\nimport=" + Read(Path.Combine(cwd, "input.bin")));
        ProcessStartInfo child = new ProcessStartInfo();
        child.FileName = Process.GetCurrentProcess().MainModule.FileName;
        child.Arguments = "child " + Quote(privateFile);
        child.UseShellExecute = false;
        child.CreateNoWindow = true;
        child.WorkingDirectory = cwd;
        using (Process process = Process.Start(child))
        {
            if (process == null || !process.WaitForExit(1500)) return 6;
            return process.ExitCode;
        }
    }
}
