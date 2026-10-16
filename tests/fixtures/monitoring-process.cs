using System;
using System.Threading;

// A disposable signature fixture, not a real AI provider. It exits on stdin
// closure or after three minutes, without accessing files or the network.
internal static class MonitoringProcess
{
    private static int Main()
    {
        using (var stop = new ManualResetEvent(false))
        {
            var reader = new Thread(delegate() { Console.ReadLine(); stop.Set(); });
            reader.IsBackground = true;
            reader.Start();
            Console.WriteLine("ready");
            stop.WaitOne(180000);
        }
        return 0;
    }
}
