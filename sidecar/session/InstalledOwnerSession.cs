using System;
using System.Diagnostics;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal static class InstalledOwnerSession
    {
        // 0..7 are existing protocol codes. New codes are fixed last checkpoints:
        // 8 publication, 9 core entry, 10 server, 11 proof, 12 exit, 13 endpoint
        // handles, 14 inheritance, 15 endpoint peer, 16 installed fence fallback,
        // 17 poll peer, 18 installed poll fallback, 19 deadline, 20 admission entry,
        // 21 admission peer, 22 endpoint state. Nested registration 14..26/36..44
        // is prefixed by 100 (fence) or 200 (poll); constructor-only gaps are refused.
        private static bool KnownStageSeven(uint checkpoint)
        {
            return checkpoint <= 22 || (checkpoint >= 114 && checkpoint <= 126) ||
                (checkpoint >= 136 && checkpoint <= 144) ||
                (checkpoint >= 214 && checkpoint <= 226) || (checkpoint >= 236 && checkpoint <= 244);
        }
        internal static byte[] FailureFrame(int stage, int substage)
        {
            CallerNative.Require(stage >= 1 && stage <= 12 && substage >= 0 && ((stage == 2 && substage <= 44) || (stage == 7 && KnownStageSeven((uint)substage)) || substage == 0));
            return Encoding.ASCII.GetBytes("AEGISF02" + stage.ToString("x8") + substage.ToString("x8") + new string('0', 80));
        }
        internal static bool TryReadFailureFrame(string frame, out uint stage, out uint substage)
        {
            stage = 0; substage = 0;
            if (!System.Text.RegularExpressions.Regex.IsMatch(frame ?? "", "\\AAEGISF02[a-f0-9]{16}0{80}\\z")) return false;
            uint parsedStage = Convert.ToUInt32(frame.Substring(8, 8), 16);
            uint parsedSubstage = Convert.ToUInt32(frame.Substring(16, 8), 16);
            if (parsedStage < 1 || parsedStage > 12 || !((parsedStage == 2 && parsedSubstage <= 44) || (parsedStage == 7 && KnownStageSeven(parsedSubstage)) || parsedSubstage == 0)) return false;
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
                                    stage = 7; substage = 1; CallerMainOperation.Context admitted = operation.Accept(Math.Min(2000, deadline.Remaining), ref substage);
                                    // Admission reverted its thread token. Recheck installed authority immediately before the fixed observation.
                                    stage = 8; substage = 0; registration.CheckCurrent(); deadline.Check(); admitted.CheckCurrent();
                                    stage = 9;
                                    using (var vm = InstalledVmRegistration.AcquireIfConfigured(registration, admitted))
                                    {
                                        deadline.Check(); string result = admitted.InspectOwned();
                                        if (vm != null) vm.Inspect();
                                        // Independently persisted actual-dispatch oracle outside the pinned installation root.
                                        stage = 10; InstalledOwnerFiles.WriteNew(true, "inspection-count.txt", "1", registration.Policy);
                                        registration.CheckCurrent(); deadline.Check(); admitted.CheckCurrent();
                                        if (vm != null) vm.Inspect();
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
}
