using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

// Owned synthetic home and sockets only. No AI provider or application data transfer.
internal static class SensorProcess
{
    private static TcpClient Connect(string address, int port)
    {
        var client = new TcpClient(AddressFamily.InterNetwork);
        try
        {
            var pending = client.BeginConnect(IPAddress.Parse(address), port, null, null);
            using (pending.AsyncWaitHandle)
                if (!pending.AsyncWaitHandle.WaitOne(5000)) throw new TimeoutException();
            client.EndConnect(pending);
            return client;
        }
        catch { client.Close(); throw; }
    }

    private static int Main(string[] args)
    {
        if (args.Length != 2 || !Directory.Exists(args[0])) return 1;
        using (var lifetime = new Timer(delegate { Environment.Exit(2); }, null, 180000, Timeout.Infinite))
        using (var held = File.OpenRead(Path.Combine(args[0], ".ssh", "sensor-held.txt")))
        using (var envHeld = File.OpenRead(Path.Combine(args[0], ".env.sensor-held")))
        using (var first = Connect(args[1], 443))
        using (var second = Connect(args[1], 443))
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try
            {
                using (var local = Connect("127.0.0.1", ((IPEndPoint)listener.LocalEndpoint).Port))
                using (var accepted = listener.AcceptTcpClient())
                {
                    held.ReadByte(); envHeld.ReadByte();
                    Console.WriteLine("{\"ready\":true,\"ports\":[" + ((IPEndPoint)first.Client.LocalEndPoint).Port + "," + ((IPEndPoint)second.Client.LocalEndPoint).Port + "],\"loopbackPort\":" + ((IPEndPoint)listener.LocalEndpoint).Port + "}");
                    var file = Path.Combine(args[0], ".env.sensor-events");
                    var content = File.ReadAllText(Path.Combine(args[0], ".env.sensor-held"));
                    string command;
                    while ((command = Console.ReadLine()) != null && command != "stop")
                    {
                        if (command == "create") File.WriteAllText(file, content);
                        else if (command == "modify") File.AppendAllText(file, content);
                        else if (command == "delete") File.Delete(file);
                        else if (command == "close-network") { first.Close(); second.Close(); }
                        else return 1;
                        Console.WriteLine("{\"command\":\"" + command + "\",\"ok\":true}");
                    }
                }
            }
            finally { listener.Stop(); }
        }
        return 0;
    }
}
