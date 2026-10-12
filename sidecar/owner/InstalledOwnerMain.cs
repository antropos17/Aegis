using System;
using System.Text;
using System.Text.RegularExpressions;
using Aegis.ProtectedSession;

namespace Aegis.InstalledOwner
{
    // Headless Session-0 controller. No Electron/UI, token selector, command or path input.
    internal static class InstalledOwnerMain
    {
        private static int Main(string[] arguments)
        {
            if (arguments.Length != 1 || arguments[0] != "--installed-main") return 2;
            int checkpoint = 201;
            try
            {
                var deadline = new InstalledOwnerDeadline(9000);
                CallerNative.Require(InstalledOwnerPipe.GetStdHandle(-11) == new IntPtr(-1) && InstalledOwnerPipe.GetStdHandle(-12) == new IntPtr(-1));
                checkpoint = 202;
                using (var input = InstalledOwnerPipe.Standard(-10))
                {
                    checkpoint = 203;
                    byte[] bytes = InstalledOwnerPipe.ReadExact(input, 224, deadline); InstalledOwnerPipe.Eof(input, deadline);
                    string text = Encoding.ASCII.GetString(bytes); CallerNative.Require(text.StartsWith("AEGISM02", StringComparison.Ordinal));
                    byte[] oldFrame = new byte[CallerBootstrapFrame.Size]; Buffer.BlockCopy(bytes, 8, oldFrame, 0, oldFrame.Length);
                    checkpoint = 204;
                    CallerBootstrapFrame routing = CallerBootstrapFrame.Parse(oldFrame);
                    string selection = text.Substring(152, 32), epoch = text.Substring(184, 32);
                    uint revision = Convert.ToUInt32(text.Substring(216, 8), 16);
                    CallerNative.Require(Regex.IsMatch(selection + epoch, "\\A[a-f0-9]{64}\\z") && revision > 0);
                    // Bounded native observations distinguish bootstrap import refusals without emitting token data.
                    checkpoint = 209;
                    using (var observed = CallerNative.Duplicate(routing.ServerHandle))
                    {
                        CallerEndpointNative.RequireNonInherited(observed);
                        checkpoint = 210;
                        long birth, exit, kernel, user;
                        CallerNative.Require(CallerNative.GetProcessTimes(observed, out birth, out exit, out kernel, out user));
                        checkpoint = 211;
                        CallerNative.Require(CallerNative.GetProcessId(observed) == routing.ServerPid && birth == routing.ServerBirth);
                        checkpoint = 212;
                        using (var token = CallerNative.ProcessToken(observed))
                        {
                            checkpoint = 213;
                            var identity = CallerIdentity.Observe(token);
                            checkpoint = 214;
                            CallerNative.Require(identity.PermittedBroker());
                        }
                        checkpoint = 215;
                        CallerNative.Require(CallerNative.WaitForSingleObject(observed, 0) == 0x102);
                    }
                    checkpoint = 205;
                    using (var server = routing.ImportServer())
                    {
                        checkpoint = 206;
                        using (var pipe = CallerEndpoint.ConnectLocal(routing.Locator, server, Math.Min(2000, deadline.Remaining)))
                        {
                            string frame = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"role\":\"controller-main\",\"operation\":\"inspect-owned\",\"requestId\":\"" + Guid.NewGuid().ToString("N") +
                                "\",\"sessionId\":\"" + routing.Session + "\",\"generation\":\"" + routing.Generation + "\",\"selectionId\":\"" + selection +
                                "\",\"inventoryRevision\":" + revision + ",\"selectionEpoch\":\"" + epoch + "\",\"sequence\":1}";
                            byte[] body = Encoding.UTF8.GetBytes(frame), wire = new byte[body.Length + 4];
                            Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, wire, 0, 4); Buffer.BlockCopy(body, 0, wire, 4, body.Length);
                            checkpoint = 207;
                            InstalledOwnerPipe.Send(pipe, wire, deadline);
                            checkpoint = 208;
                            // Keep the authenticated peer/connection alive until original owner supervision ends the session.
                            while (true) { deadline.Check(); System.Threading.Thread.Sleep(2); }
                        }
                    }
                }
            }
            // Fixed startup checkpoints only; no native exception text or input becomes output.
            catch { return checkpoint; }
        }
    }
}
