using System;
using System.Diagnostics;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal static class InstalledOwnerSession
    {
        internal static byte[] FailureFrame(int stage, int substage)
        {
            CallerNative.Require(stage >= 1 && stage <= 12 && substage >= 0 && substage <= 13 && (stage == 2 || substage == 0));
            return Encoding.ASCII.GetBytes("AEGISF02" + stage.ToString("x8") + substage.ToString("x8") + new string('0', 80));
        }
        internal static bool TryReadFailureFrame(string frame, out uint stage, out uint substage)
        {
            stage = 0; substage = 0;
            if (!System.Text.RegularExpressions.Regex.IsMatch(frame ?? "", "\\AAEGISF02[a-f0-9]{16}0{80}\\z")) return false;
            uint parsedStage = Convert.ToUInt32(frame.Substring(8, 8), 16);
            uint parsedSubstage = Convert.ToUInt32(frame.Substring(16, 8), 16);
            if (parsedStage < 1 || parsedStage > 12 || parsedSubstage > 13 || (parsedStage != 2 && parsedSubstage != 0)) return false;
            stage = parsedStage; substage = parsedSubstage; return true;
        }
        internal static int Run()
        {
            var deadline = new InstalledOwnerDeadline(10000); int stage = 1, substage = 0;
            CallerNative.Require(!CallerNative.HasThreadToken() && InstalledOwnerPipe.GetStdHandle(-12) == new IntPtr(-1));
            using (var output = InstalledOwnerPipe.Standard(-11))
            {
                try { return RunCore(output, deadline, ref stage, ref substage); }
                catch
                {
                    // Fixed stage/substage on the original private channel; no native exception data is serialized.
                    try { InstalledOwnerPipe.Send(output, FailureFrame(stage, substage), new InstalledOwnerDeadline(100)); }
                    catch { }
                    return 2;
                }
            }
        }
        private static int RunCore(SafeFileHandle output, InstalledOwnerDeadline deadline, ref int stage, ref int substage)
        {
            using (var input = InstalledOwnerPipe.Standard(-10))
            using (var setup = InstalledOwnerBootstrap.Receive(input, deadline))
            {
                stage = 2;
                using (var registration = new InstalledOwnerRegistration(setup, ref substage))
                {
                    substage = 12;
                    using (var current = Process.GetCurrentProcess())
                    {
                        substage = 13;
                        using (var heldSelf = CallerNative.Duplicate(current.Handle))
                        {
                            stage = 3; substage = 0;
                            using (var lease = EnrollmentLease.Acquire(InstalledOwnerPolicy.Root, heldSelf.DangerousGetHandle(), setup.Job.DangerousGetHandle()))
                            using (var server = new CallerRegistration(heldSelf.DangerousGetHandle(), setup.Session))
                            {
                                stage = 4;
                                using (var operation = CallerMainOperation.AcquireInstalled(lease, server, setup.Main.DangerousGetHandle(), registration))
                                {
                                    stage = 5; registration.Policy.CheckTuple(lease.BindServer(server));
                                    registration.CheckCurrent(); deadline.Check();
                                    string locator = operation.Labels.Locator.Substring("\\\\.\\pipe\\aegis-owned-caller-".Length);
                                    stage = 6;
                                    InstalledOwnerPipe.Send(output, Encoding.ASCII.GetBytes("AEGISC02" + locator + operation.Labels.Session + operation.Labels.Generation), deadline);
                                    stage = 7; CallerMainOperation.Context admitted = operation.Accept(Math.Min(2000, deadline.Remaining));
                                    // Admission reverted its thread token. Recheck installed authority immediately before the fixed observation.
                                    stage = 8; registration.CheckCurrent(); deadline.Check(); admitted.CheckCurrent();
                                    stage = 9; deadline.Check(); string result = admitted.InspectOwned();
                                    // Independently persisted actual-dispatch oracle outside the pinned installation root.
                                    stage = 10; InstalledOwnerFiles.WriteNew(true, "inspection-count.txt", "1", registration.Policy);
                                    registration.CheckCurrent(); deadline.Check(); admitted.CheckCurrent();
                                    byte[] body = Encoding.UTF8.GetBytes(result); CallerNative.Require(body.Length > 0 && body.Length <= 1024);
                                    stage = 11;
                                    InstalledOwnerPipe.Send(output, Encoding.ASCII.GetBytes("AEGISR02" + body.Length.ToString("x8")), deadline);
                                    InstalledOwnerPipe.Send(output, body, deadline); stage = 12; return 0;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
