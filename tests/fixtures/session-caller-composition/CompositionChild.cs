using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using Aegis.ProtectedSession;

internal static class CompositionChild
{
    private static int Main()
    {
        try
        {
            // Disposable fixture routing only. This is not a protected bootstrap.
            string control = Environment.GetEnvironmentVariable("AEGIS_COMPOSITION_CONTROL");
            string[] setup = File.ReadAllLines(Path.Combine(control, "setup.txt"));
            if (Environment.GetEnvironmentVariable("AEGIS_COMPOSITION_ROLE") == "descendant")
            {
                File.WriteAllText(Path.Combine(control, "descendant.pid"), Process.GetCurrentProcess().Id.ToString());
                Thread.Sleep(Timeout.Infinite); return 0;
            }
            var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName);
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.EnvironmentVariables["AEGIS_COMPOSITION_ROLE"] = "descendant";
            using (Process descendant = Process.Start(start))
            {
                LauncherObservation.ReadPid(Path.Combine(control, "descendant.pid"));
                File.WriteAllText(Path.Combine(control, "payload.pid"), Process.GetCurrentProcess().Id.ToString());
                if (Environment.GetEnvironmentVariable("AEGIS_COMPOSITION_MODE") == "admission-timeout")
                { Thread.Sleep(Timeout.Infinite); return 0; }
                // The fixture selects its held parent by PID; production never uses this delivery.
                using (Process server = Process.GetProcessById(int.Parse(setup[3])))
                using (var registration = new CallerRegistration(server.Handle, setup[1]))
                using (var pipe = CallerEndpoint.ConnectLocal(setup[0], registration, 1000))
                {
                    string frame = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1," +
                        "\"operation\":\"inspect-owned\",\"requestId\":\"" + new string('c', 32) +
                        "\",\"sessionId\":\"" + setup[1] + "\",\"generation\":\"" + setup[2] + "\",\"sequence\":1}";
                    byte[] body = Encoding.UTF8.GetBytes(frame), bytes = new byte[body.Length + 4];
                    Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, bytes, 0, 4);
                    Buffer.BlockCopy(body, 0, bytes, 4, body.Length); uint written;
                    CallerNative.Require(CallerEndpointNative.WriteFile(pipe, bytes, (uint)bytes.Length, out written,
                        IntPtr.Zero) && written == bytes.Length);
                    File.WriteAllText(Path.Combine(control, "frame.pid"), Process.GetCurrentProcess().Id.ToString());
                    Thread.Sleep(Timeout.Infinite); return 0;
                }
            }
        }
        catch (Exception error)
        {
            // Preserve a native child's full failure even when CREATE_NO_WINDOW has no stderr sink.
            string control = Environment.GetEnvironmentVariable("AEGIS_COMPOSITION_CONTROL");
            if (control != null) File.WriteAllText(Path.Combine(control,
                "child-error-" + Process.GetCurrentProcess().Id + ".txt"), error.ToString());
            Console.Error.WriteLine(error); return 1;
        }
    }
}
