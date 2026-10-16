using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Aegis.ProtectedSession;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Fixture-only native producer. This method is absent from all production outputs.
    internal partial class CallerLauncherNative
    {
        internal Created CreateUntrustedInstalled(string image, SafeFileHandle input, SafeFileHandle output)
        { return CreateCore(image, input, output, null, "--installed-owner-session"); }
    }
}

internal static class InstalledOwnerFixture
{
    // Disposable anonymous pipes exercise the maintained parser without creating
    // an installed registration, service, account or production owner runtime.
    private static string ReadFailure(string frame, bool split)
    {
        using (var pipe = new InstalledOwnerPipe(false))
        {
            var deadline = new InstalledOwnerDeadline(2000);
            InstalledOwnerPipe.Send(pipe.Write, Encoding.ASCII.GetBytes(frame), deadline);
            string value = Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(pipe.Read, split ? 16 : frame.Length, deadline));
            if (split) value += Encoding.ASCII.GetString(InstalledOwnerPipe.ReadExact(pipe.Read, frame.Length - 16, deadline));
            return value;
        }
    }
    private static string Frame(uint stage, uint substage)
    { return "AEGISF02" + stage.ToString("x8") + substage.ToString("x8") + new string('0', 80); }
    private static string Parsed(string frame, bool split)
    {
        uint stage, substage; bool accepted = InstalledOwnerSession.TryReadFailureFrame(ReadFailure(frame, split), out stage, out substage);
        return "{\"accepted\":" + (accepted ? "true" : "false") + ",\"stage\":" + stage + ",\"substage\":" + substage + "}";
    }
    private delegate void DiagnosticCheck(ref int substage);
    private static void ExpectCheckpoint(List<string> rows, string mode, int expected, DiagnosticCheck check)
    {
        int checkpoint = 0; bool refused = false;
        try { check(ref checkpoint); }
        catch (InvalidOperationException) { refused = true; }
        CallerNative.Require(refused && checkpoint == expected && !CallerNative.HasThreadToken());
        byte[] frame = InstalledOwnerSession.FailureFrame(7, checkpoint); uint stage, substage;
        CallerNative.Require(frame.Length == 104 && InstalledOwnerSession.TryReadFailureFrame(Encoding.ASCII.GetString(frame), out stage, out substage) && stage == 7 && substage == expected);
        rows.Add("{\"mode\":\"" + mode + "\",\"checkpoint\":" + checkpoint + "}");
    }
    private static int PrecheckCheckpoints()
    {
        var rows = new List<string>();
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        Type operationType = typeof(CallerMainOperation);
        var operation = (CallerMainOperation)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(operationType);
        operationType.GetField("closed", flags).SetValue(operation, true);
        var core = (DiagnosticCheck)Delegate.CreateDelegate(typeof(DiagnosticCheck), operation,
            operationType.GetMethod("CheckCore", flags, null, new Type[] { typeof(int).MakeByRefType() }, null));
        ExpectCheckpoint(rows, "operation-entry", 9, core);
        using (var self = Process.GetCurrentProcess())
        using (var peer = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var endpoint = new CallerEndpoint(peer, self.Handle))
        {
            operationType.GetField("server", flags).SetValue(operation, peer);
            operationType.GetField("published", flags).SetValue(operation, true);
            ExpectCheckpoint(rows, "operation-publication", 8, delegate(ref int checkpoint) { operation.Accept(20, ref checkpoint); });
            var pipe = (SafeFileHandle)typeof(CallerEndpoint).GetField("pipe", flags).GetValue(endpoint);
            CallerNative.Require(SetHandleInformation(pipe, 1, 1));
            try { ExpectCheckpoint(rows, "endpoint-inheritance", 14, endpoint.CheckCurrent); }
            finally { CallerNative.Require(SetHandleInformation(pipe, 1, 0)); }
            var registration = (InstalledOwnerRegistration)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(typeof(InstalledOwnerRegistration));
            // Constructor bypass also bypasses the synchronization-field initializer.
            typeof(InstalledOwnerRegistration).GetField("JournalGate", flags).SetValue(registration, new object());
            typeof(InstalledOwnerRegistration).GetField("closed", flags).SetValue(registration, true);
            typeof(CallerEndpoint).GetField("installed", flags).SetValue(endpoint, registration);
            ExpectCheckpoint(rows, "installed-fence-entry", 114, endpoint.CheckCurrent);
            ExpectCheckpoint(rows, "installed-poll-entry", 214, delegate(ref int checkpoint) { endpoint.AcceptMain(20, ref checkpoint); });
            ExpectCheckpoint(rows, "endpoint-deadline", 19, delegate(ref int checkpoint) { endpoint.AcceptMain(0, ref checkpoint); });
            ExpectCheckpoint(rows, "endpoint-closed", 13, endpoint.CheckCurrent);
        }
        using (var self = Process.GetCurrentProcess())
        using (var peer = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var endpoint = new CallerEndpoint(peer, self.Handle))
        {
            peer.Dispose();
            ExpectCheckpoint(rows, "endpoint-peer", 15, endpoint.CheckCurrent);
            ExpectCheckpoint(rows, "poll-peer", 17, delegate(ref int checkpoint) { endpoint.AcceptMain(20, ref checkpoint); });
            using (var invalid = new SafeFileHandle(new IntPtr(-1), false))
                ExpectCheckpoint(rows, "admission-peer", 21, delegate(ref int checkpoint) { CallerAdmission.ReadMainAndAuthenticate(invalid, peer, new CallerNative(), ref checkpoint); });
        }
        Console.WriteLine("{\"rows\":[" + String.Join(",", rows) + "]}"); return 0;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(SafeHandle handle, uint mask, uint flags);
    private static int CheckClosedRegistration()
    {
        // No installation, handles or service: the first assertion must refuse
        // before touching any resource, through both diagnostic and later calls.
        Type type = typeof(InstalledOwnerRegistration);
        var registration = (InstalledOwnerRegistration)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(type);
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        type.GetField("JournalGate", flags).SetValue(registration, new object());
        type.GetField("closed", flags).SetValue(registration, true);
        int checkpoint = 11;
        var check = (DiagnosticCheck)Delegate.CreateDelegate(typeof(DiagnosticCheck), registration,
            type.GetMethod("CheckCurrent", flags, null, new Type[] { typeof(int).MakeByRefType() }, null));
        Exception diagnosed = null, later = null;
        try { check(ref checkpoint); }
        catch (InvalidOperationException error) { diagnosed = error; }
        try { registration.CheckCurrent(); }
        catch (InvalidOperationException error) { later = error; }
        CallerNative.Require(diagnosed is InvalidOperationException && later != null && diagnosed.Message == later.Message && checkpoint == 14);
        return 2;
    }
    private sealed class RefuseAuthentication : CallerNative
    {
        internal override bool Impersonate(SafeHandle pipe) { return false; }
    }
    private static int AdmissionCheckpoints()
    {
        var rows = new List<string>();
        string[] modes = { "precheck", "connect-error", "connect-timeout", "framing", "authentication", "postcheck", "message-timeout" };
        int[] expected = { 22, 2, 3, 4, 5, 6, 7 };
        for (int index = 0; index < modes.Length; index++)
        using (var self = Process.GetCurrentProcess())
        using (var peer = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var endpoint = new CallerEndpoint(peer, self.Handle))
        {
            int checkpoint = 0; bool refused = false;
            var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
            var pipe = (SafeFileHandle)typeof(CallerEndpoint).GetField("pipe", flags).GetValue(endpoint);
            try
            {
                if (index == 0) { endpoint.Dispose(); endpoint.AcceptMain(20, ref checkpoint); }
                else if (index == 1) { pipe.Dispose(); endpoint.AcceptMain(20, ref checkpoint); }
                else if (index == 2) endpoint.AcceptMain(20, ref checkpoint);
                else using (var client = CallerEndpointNative.CreateFile(endpoint.LocalLocator, CallerEndpointNative.ClientRights,
                    0, IntPtr.Zero, 3, 0x00100000 | 0x00020000, IntPtr.Zero))
                {
                    CallerNative.Require(!client.IsInvalid);
                    if (index != 6)
                    {
                        string body = index == 3 ? "{}" : "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"role\":\"controller-main\",\"operation\":\"inspect-owned\",\"requestId\":\"" + new string('b', 32) +
                            "\",\"sessionId\":\"" + peer.Session + "\",\"generation\":\"" + peer.Generation + "\",\"selectionId\":\"" + new string('c', 32) +
                            "\",\"inventoryRevision\":" + (index == 5 ? "4294967296" : "1") + ",\"selectionEpoch\":\"" + new string('d', 32) + "\",\"sequence\":1}";
                        byte[] payload = Encoding.UTF8.GetBytes(body), frame = new byte[payload.Length + 4];
                        Array.Copy(BitConverter.GetBytes(payload.Length), frame, 4); Array.Copy(payload, 0, frame, 4, payload.Length);
                        uint written; CallerNative.Require(CallerEndpointNative.WriteFile(client, frame, (uint)frame.Length, out written, IntPtr.Zero) && written == frame.Length);
                    }
                    // The real one-shot endpoint proves connect/framing/timeouts. The retained
                    // pipe permits an existing native seam to force authentication refusal.
                    if (index == 4) CallerAdmission.ReadMainAndAuthenticate(pipe, peer, new RefuseAuthentication(), ref checkpoint);
                    else endpoint.AcceptMain(2000, ref checkpoint);
                }
            }
            catch (InvalidOperationException) { refused = true; }
            catch (TimeoutException) { refused = true; }
            CallerNative.Require(refused && checkpoint == expected[index] && !CallerNative.HasThreadToken());
            uint stage, substage;
            CallerNative.Require(InstalledOwnerSession.TryReadFailureFrame(Encoding.ASCII.GetString(InstalledOwnerSession.FailureFrame(7, checkpoint)), out stage, out substage) && stage == 7 && substage == expected[index]);
            rows.Add("{\"mode\":\"" + modes[index] + "\",\"checkpoint\":" + checkpoint + "}");
        }
        Console.WriteLine("{\"rows\":[" + String.Join(",", rows) + "]}"); return 0;
    }
    private static int FailureFrames()
    {
        int entryChecks = CheckClosedRegistration();
        var rows = new List<string>();
        for (uint stage = 1; stage <= 12; stage++)
            rows.Add("{\"kind\":\"legacy\",\"expectedStage\":" + stage + ",\"expectedSubstage\":0,\"whole\":" + Parsed(Frame(stage, 0), false) + ",\"split\":" + Parsed(Frame(stage, 0), true) + "}");
        for (uint substage = 1; substage <= 44; substage++)
            rows.Add("{\"kind\":\"stage2\",\"expectedStage\":2,\"expectedSubstage\":" + substage + ",\"whole\":" + Parsed(Frame(2, substage), false) + ",\"split\":" + Parsed(Frame(2, substage), true) + "}");
        uint[] stageSeven = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
            114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126,
            136, 137, 138, 139, 140, 141, 142, 143, 144,
            214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226,
            236, 237, 238, 239, 240, 241, 242, 243, 244 };
        foreach (uint substage in stageSeven)
            rows.Add("{\"kind\":\"stage7\",\"expectedStage\":7,\"expectedSubstage\":" + substage + ",\"whole\":" + Parsed(Frame(7, substage), false) + ",\"split\":" + Parsed(Frame(7, substage), true) + "}");
        for (uint checkpoint = 1; checkpoint <= 24; checkpoint++)
            rows.Add("{\"kind\":\"stage9\",\"expectedStage\":9,\"expectedSubstage\":" + checkpoint + ",\"whole\":" + Parsed(Frame(9, checkpoint), false) + ",\"split\":" + Parsed(Frame(9, checkpoint), true) + "}");
        for (uint checkpoint = 1; checkpoint <= 6; checkpoint++)
            rows.Add("{\"kind\":\"stage10\",\"expectedStage\":10,\"expectedSubstage\":" + checkpoint + ",\"whole\":" + Parsed(Frame(10, checkpoint), false) + ",\"split\":" + Parsed(Frame(10, checkpoint), true) + "}");
        string[] invalid = { Frame(10, 7), Frame(10, UInt32.MaxValue), Frame(9, 25), Frame(9, UInt32.MaxValue), Frame(7, 23), Frame(7, UInt32.MaxValue), Frame(0, 0), Frame(13, 0), Frame(2, 45), Frame(1, 1), Frame(3, 13),
            Frame(1, 14), Frame(3, 26), Frame(12, 26),
            Frame(2, 8).Substring(0, 103) + "1", Frame(2, 8).Replace("00000008", "0000000A"),
            "AEGISF03" + Frame(2, 8).Substring(8), Frame(2, 8).Substring(0, 103), Frame(2, 8) + "0" };
        for (int index = 0; index < invalid.Length; index++)
            rows.Add("{\"kind\":\"invalid\",\"index\":" + index + ",\"whole\":" + Parsed(invalid[index], false) + ",\"split\":" + Parsed(invalid[index], true) + "}");
        int writerChecks = 0;
        for (int checkpoint = 0; checkpoint <= 44; checkpoint++)
        {
            byte[] frame = InstalledOwnerSession.FailureFrame(2, checkpoint);
            CallerNative.Require(frame.Length == 104 && Encoding.ASCII.GetString(frame) == Frame(2, (uint)checkpoint));
            writerChecks++;
        }
        CallerNative.Require(Encoding.ASCII.GetString(InstalledOwnerSession.FailureFrame(7, 0)) == Frame(7, 0));
        writerChecks++;
        foreach (uint checkpoint in stageSeven)
        {
            CallerNative.Require(Encoding.ASCII.GetString(InstalledOwnerSession.FailureFrame(7, (int)checkpoint)) == Frame(7, checkpoint));
            writerChecks++;
        }
        for (int checkpoint = 0; checkpoint <= 6; checkpoint++)
        {
            byte[] frame = InstalledOwnerSession.FailureFrame(10, checkpoint);
            CallerNative.Require(frame.Length == 104 && Encoding.ASCII.GetString(frame) == Frame(10, (uint)checkpoint)); writerChecks++;
        }
        int[,] invalidWriter = { { 10, -1 }, { 10, 7 }, { 7, -1 }, { 7, 23 }, { 0, 0 }, { 13, 0 }, { 2, -1 }, { 2, 45 }, { 1, 14 }, { 3, 26 }, { 12, 26 } };
        for (int index = 0; index < invalidWriter.GetLength(0); index++)
        {
            bool refused = false;
            try { InstalledOwnerSession.FailureFrame(invalidWriter[index, 0], invalidWriter[index, 1]); }
            catch (InvalidOperationException) { refused = true; }
            CallerNative.Require(refused); writerChecks++;
        }
        for (uint checkpoint = 23; checkpoint <= 255; checkpoint++)
        {
            if (Array.IndexOf(stageSeven, checkpoint) >= 0) continue;
            uint gapStage, gapSubstage;
            CallerNative.Require(!InstalledOwnerSession.TryReadFailureFrame(Frame(7, checkpoint), out gapStage, out gapSubstage));
            bool refused = false;
            try { InstalledOwnerSession.FailureFrame(7, (int)checkpoint); }
            catch (InvalidOperationException) { refused = true; }
            CallerNative.Require(refused);
        }
        byte[] issued = InstalledOwnerSession.FailureFrame(2, 26); uint writerStage, writerSubstage;
        bool writerAccepted = InstalledOwnerSession.TryReadFailureFrame(Encoding.ASCII.GetString(issued), out writerStage, out writerSubstage);
        Console.WriteLine("{\"entryChecks\":" + entryChecks + ",\"writerChecks\":" + writerChecks + ",\"frameBytes\":" + issued.Length + ",\"writer\":{\"accepted\":" + (writerAccepted ? "true" : "false") +
            ",\"stage\":" + writerStage + ",\"substage\":" + writerSubstage + "},\"parsed\":" + Parsed(Frame(2, 8), false) +
            ",\"rows\":[" + String.Join(",", rows) + "]}");
        return 0;
    }
    private static int AccountingControls()
    {
        int checks = 0;
        int[] errors = { 5, 6, 87, 24, 122, 0, 999 };
        int[] expected = { 27, 28, 29, 30, 30, 31, 31 };
        for (int index = 0; index < errors.Length; index++)
        { CallerNative.Require(GuestJobNative.SingletonCheckpoint(false, errors[index], new GuestJobNative.Accounting()) == expected[index]); checks++; }
        uint[,] counts = { { 1, 1, 0 }, { 99, 1, 0 }, { 64, 65, 32 }, { 0, 1, 33 }, { 0, 0, 34 }, { 2, 2, 35 } };
        for (int index = 0; index < counts.GetLength(0); index++)
        {
            CallerNative.Require(GuestJobNative.SingletonCheckpoint(true, 5,
                new GuestJobNative.Accounting { Total = counts[index, 0], Active = counts[index, 1] }) == counts[index, 2]); checks++;
        }
        int checkpoint = 25; bool refused = false;
        try { GuestJobNative.RequireSingleton(new IntPtr(-1), ref checkpoint); }
        catch (InvalidDataException) { refused = true; }
        CallerNative.Require(refused && checkpoint == 28);
        byte[] frame = InstalledOwnerSession.FailureFrame(2, checkpoint); uint stage, substage;
        CallerNative.Require(frame.Length == 104 && InstalledOwnerSession.TryReadFailureFrame(Encoding.ASCII.GetString(frame), out stage, out substage) && stage == 2 && substage == 28);
        using (var job = CreateJobObject(IntPtr.Zero, null))
        using (var first = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var second = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        {
            try
            {
                CallerNative.Require(!job.IsInvalid && AssignProcessToJobObject(job, first.Handle));
                checkpoint = 25; GuestJobNative.RequireSingleton(job.DangerousGetHandle(), ref checkpoint);
                CallerNative.Require(checkpoint == 25);
                CallerNative.Require(AssignProcessToJobObject(job, second.Handle));
                checkpoint = 25; refused = false;
                try { GuestJobNative.RequireSingleton(job.DangerousGetHandle(), ref checkpoint); }
                catch (InvalidDataException) { refused = true; }
                CallerNative.Require(refused && checkpoint == 35);
            }
            finally
            {
                CallerNative.Require(TerminateJobObject(job, 1));
                if (!first.WaitForExit(2000)) first.Kill();
                if (!second.WaitForExit(2000)) second.Kill();
                CallerNative.Require(first.WaitForExit(2000) && second.WaitForExit(2000));
            }
            var watch = Stopwatch.StartNew();
            while (GuestJobNative.Counts(job.DangerousGetHandle()).Active != 0)
            { CallerNative.Require(watch.ElapsedMilliseconds < 2000); System.Threading.Thread.Sleep(2); }
        }
        Console.WriteLine("{\"syntheticChecks\":" + checks + ",\"queryRefused\":true,\"singletonAccepted\":true,\"extraMemberRefused\":true,\"ownedJobsEmpty\":true}");
        return 0;
    }
    private static CallerIdentity SystemIdentity(string sid, string integrity, int session, uint authentication)
    {
        Type type = typeof(CallerIdentity);
        var value = (CallerIdentity)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(type);
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        type.GetField("sid", flags).SetValue(value, sid);
        type.GetField("integrity", flags).SetValue(value, integrity);
        type.GetField("session", flags).SetValue(value, session);
        type.GetField("Type", flags).SetValue(value, 1);
        type.GetField("restricting", flags).SetValue(value, new string[0]);
        type.GetField("groups", flags).SetValue(value, new string[0]);
        type.GetField("privileges", flags).SetValue(value, new string[0]);
        var luidType = type.GetNestedType("Luid", System.Reflection.BindingFlags.NonPublic);
        object luid = Activator.CreateInstance(luidType);
        luidType.GetField("Low", flags).SetValue(luid, authentication);
        type.GetField("authentication", flags).SetValue(value, luid);
        return value;
    }
    private static void SealedNativeControls(CallerIdentity root)
    {
        using (var job = CreateJobObject(IntPtr.Zero, null))
        using (var child = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var extra = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var held = CallerNative.Duplicate(child.Handle))
        {
            // The SYSTEM identity seam never appears in production. Job membership,
            // held births, historical accounting and image observations remain native.
            InstalledJobInventory.TokenForTest = delegate(SafeFileHandle unused) { return root; };
            try
            {
                CallerNative.Require(AssignProcessToJobObject(job, child.Handle));
                long birth = GuestJobNative.Birth(held.DangerousGetHandle(), job.DangerousGetHandle(), CallerNative.GetProcessId(held));
                int checkpoint = 0;
                using (var inventory = new InstalledJobInventory(job, held, birth, ref checkpoint))
                {
                    inventory.CheckCurrent(ref checkpoint);
                    CallerNative.Require(AssignProcessToJobObject(job, extra.Handle));
                    bool lateRefused = false;
                    try { inventory.CheckCurrent(ref checkpoint); } catch (InvalidOperationException) { lateRefused = true; }
                    CallerNative.Require(lateRefused && checkpoint == 44);
                }
                checkpoint = 0; bool wrongImage = false;
                try { using (var inventory = new InstalledJobInventory(job, held, birth, ref checkpoint)) { } }
                catch (InvalidOperationException) { wrongImage = true; }
                CallerNative.Require(wrongImage && checkpoint == 40);
                extra.Kill(); CallerNative.Require(extra.WaitForExit(2000));
                var watch = Stopwatch.StartNew();
                while (GuestJobNative.Counts(job.DangerousGetHandle()).Active != 1)
                { CallerNative.Require(watch.ElapsedMilliseconds < 2000); System.Threading.Thread.Sleep(2); }
                checkpoint = 0; bool historyRefused = false;
                try { using (var inventory = new InstalledJobInventory(job, held, birth, ref checkpoint)) { } }
                catch (InvalidOperationException) { historyRefused = true; }
                CallerNative.Require(historyRefused && checkpoint == 36);
            }
            finally
            {
                InstalledJobInventory.TokenForTest = null;
                CallerNative.Require(TerminateJobObject(job, 1));
                CallerNative.Require(child.WaitForExit(2000) && extra.WaitForExit(2000));
            }
        }
    }
    private static int InstalledInventoryControls()
    {
        int accounting = 0, identity = 0, protection = 0;
        CallerNative.Require(InstalledJobInventory.ValidAccounting(new GuestJobNative.Accounting { Total = 1, Active = 1 }, new uint[] { 1 })); accounting++;
        CallerNative.Require(InstalledJobInventory.ValidAccounting(new GuestJobNative.Accounting { Total = 2, Active = 2 }, new uint[] { 1, 2 })); accounting++;
        GuestJobNative.Accounting[] refused = {
            new GuestJobNative.Accounting { Total = 2, Active = 1 },
            new GuestJobNative.Accounting { Total = 3, Active = 2 },
            new GuestJobNative.Accounting { Total = 3, Active = 3 },
            new GuestJobNative.Accounting { Total = 2, Active = 2, Terminated = 1 },
            new GuestJobNative.Accounting { Total = 0, Active = 0 } };
        foreach (var value in refused) { CallerNative.Require(!InstalledJobInventory.ValidAccounting(value, new uint[] { 1, 2 })); accounting++; }
        CallerNative.Require(!InstalledJobInventory.ValidAccounting(new GuestJobNative.Accounting { Total = 2, Active = 2 }, new uint[] { 1 })); accounting++;
        CallerNative.Require(!InstalledJobInventory.SameMembers(new uint[] { 1 }, new uint[] { 1, 2 }) &&
            !InstalledJobInventory.SameMembers(new uint[] { 1, 2 }, new uint[] { 1, 3 }) &&
            InstalledJobInventory.SameMembers(new uint[] { 1, 2 }, new uint[] { 1, 2 })); accounting++;
        CallerIdentity root = SystemIdentity("S-1-5-18", "S-1-16-16384", 0, 999);
        SealedNativeControls(root);
        CallerNative.Require(InstalledJobInventory.PermittedHelper(root, SystemIdentity("S-1-5-18", "S-1-16-16384", 0, 999))); identity++;
        foreach (var candidate in new CallerIdentity[] { SystemIdentity("S-1-5-18", "S-1-16-16384", 0, 998),
            SystemIdentity("S-1-5-18", "S-1-16-16384", 1, 999), SystemIdentity("S-1-5-18", "S-1-16-12288", 0, 999),
            SystemIdentity("S-1-5-21-1-2-3-1000", "S-1-16-16384", 0, 999), null })
        { CallerNative.Require(!InstalledJobInventory.PermittedHelper(root, candidate)); identity++; }
        string[] descriptors = { "O:SYG:SYD:(A;;FA;;;SY)(A;;FR;;;BU)", "O:SYG:SYD:(A;;FA;;;SY)(A;;FW;;;BU)",
            "O:BUG:SYD:(A;;FA;;;SY)", "O:SYG:SYD:NO_ACCESS_CONTROL", "O:SYG:SYD:(A;;FA;;;SY)(A;;WD;;;BU)" };
        bool[] expected = { true, false, false, false, false };
        for (int index = 0; index < descriptors.Length; index++)
        {
            var descriptor = new System.Security.AccessControl.RawSecurityDescriptor(descriptors[index]);
            byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
            CallerNative.Require(InstalledJobInventory.ProtectedSystemImage(bytes) == expected[index]); protection++;
        }
        using (var job = CreateJobObject(IntPtr.Zero, null))
        using (var child = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var held = CallerNative.Duplicate(child.Handle))
        {
            try
            {
                CallerNative.Require(AssignProcessToJobObject(job, child.Handle));
                long birth = GuestJobNative.Birth(held.DangerousGetHandle(), job.DangerousGetHandle(), CallerNative.GetProcessId(held));
                int checkpoint = 0; bool denied = false;
                try { using (var inventory = new InstalledJobInventory(job, held, birth, ref checkpoint)) { } }
                catch (InvalidOperationException) { denied = true; }
                CallerNative.Require(denied && checkpoint == 38);
                checkpoint = 0; denied = false;
                try { using (var inventory = new InstalledJobInventory(job, held, birth + 1, ref checkpoint)) { } }
                catch (InvalidOperationException) { denied = true; }
                CallerNative.Require(denied && checkpoint == 37);
            }
            finally { CallerNative.Require(TerminateJobObject(job, 1)); CallerNative.Require(child.WaitForExit(2000)); }
            var watch = Stopwatch.StartNew();
            while (GuestJobNative.Counts(job.DangerousGetHandle()).Active != 0)
            { CallerNative.Require(watch.ElapsedMilliseconds < 2000); System.Threading.Thread.Sleep(2); }
            int finalCheckpoint = 0; bool exitedRefused = false;
            try { using (var inventory = new InstalledJobInventory(job, held, 1, ref finalCheckpoint)) { } }
            catch (InvalidOperationException) { exitedRefused = true; }
            CallerNative.Require(exitedRefused && finalCheckpoint == 36);
        }
        Console.WriteLine("{\"accountingChecks\":" + accounting + ",\"identityChecks\":" + identity + ",\"protectionChecks\":" + protection +
            ",\"nonSystemRefused\":true,\"wrongBirthRefused\":true,\"exitedRefused\":true,\"ownedJobEmpty\":true}");
        return 0;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(SafeFileHandle job, uint code);
    private static string Observation(SafeFileHandle handle)
    {
        long birth, exit, kernel, user;
        CallerNative.Require(CallerNative.GetProcessTimes(handle, out birth, out exit, out kernel, out user));
        return CallerNative.GetProcessId(handle).ToString("x8") + birth.ToString("x16");
    }
    private static int Main(string[] arguments)
    {
        if (arguments.Length == 1 && arguments[0] == "--precheck-checkpoints") return PrecheckCheckpoints();
        if (arguments.Length == 1 && arguments[0] == "--admission-checkpoints") return AdmissionCheckpoints();
        if (arguments.Length == 1 && arguments[0] == "--installed-inventory-controls") return InstalledInventoryControls();
        if (arguments.Length == 1 && arguments[0] == "--accounting-controls") return AccountingControls();
        if (arguments.Length == 1 && arguments[0] == "--failure-frames") return FailureFrames();
        if (arguments.Length == 1 && arguments[0] == "--child") { System.Threading.Thread.Sleep(20000); return 0; }
        if (arguments.Length != 3) return 2;
        CallerLauncherNative.Created child = null, main = null; bool cleanup = false; int stage = 0;
        using (var canary = Process.Start(new ProcessStartInfo { FileName = System.Reflection.Assembly.GetExecutingAssembly().Location,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true }))
        using (var input = new InstalledOwnerPipe(false))
        using (var output = new InstalledOwnerPipe(true))
        using (var self = CallerNative.DuplicateSelf())
        {
            try
            {
                var native = new CallerLauncherNative();
                stage = 1;
                child = native.CreateUntrustedInstalled(arguments[0], input.Read, output.Write);
                // The untrusted current-user producer retains a real created second root in its own Job.
                stage = 2; main = native.Create(System.Reflection.Assembly.GetExecutingAssembly().Location);
                stage = 3; CallerLauncherNative.CheckCreated(child); CallerLauncherNative.CheckCreated(main);
                input.Read.Dispose(); output.Write.Dispose();
                IntPtr owner = InstalledOwnerPipe.Reduce(self, child.Process, 0x00101000);
                IntPtr job = InstalledOwnerPipe.Reduce(child.Job, child.Process, 4);
                IntPtr controller = InstalledOwnerPipe.Reduce(main.Process, child.Process, 0x00101000);
                string frame = "AEGISO02" + owner.ToInt64().ToString("x16") + job.ToInt64().ToString("x16") + controller.ToInt64().ToString("x16") +
                    new string('0', 16) + Observation(self) + Observation(child.Process) + Observation(main.Process) +
                    new string('a', 32) + new string('b', 32) + new string('c', 32) + "00000001";
                CallerNative.Require(frame.Length == InstalledOwnerBootstrap.Size);
                var deadline = new InstalledOwnerDeadline(12000);
                InstalledOwnerPipe.Send(input.Write, Encoding.ASCII.GetBytes(frame), deadline);
                if (arguments[1] != "missing-eof") input.Write.Dispose();
                File.WriteAllText(Path.Combine(arguments[2], "producer-ready.txt"), "original-query-handles-created-and-job-bound");
                stage = 4; CallerNative.Require(CallerLauncherNative.ResumeThread(child.Thread) == 1);
                CallerNative.Require(CallerNative.WaitForSingleObject(child.Process, 11500) == 0);
                uint code; CallerNative.Require(GetExitCodeProcess(child.Process, out code) && code == 2);
                stage = 5; CallerLauncherNative.Stop(child); CallerLauncherNative.Stop(main);
                cleanup = GuestJobNative.Counts(child.Job.DangerousGetHandle()).Active == 0 && GuestJobNative.Counts(main.Job.DangerousGetHandle()).Active == 0;
                CallerNative.Require(cleanup && !canary.HasExited);
                File.WriteAllText(Path.Combine(arguments[2], "effect-counter.txt"), "0");
                Console.WriteLine("{\"refused\":true,\"effects\":0,\"producerReady\":true,\"ownedJobsEmpty\":true,\"unrelatedCanarySurvived\":true}"); return 0;
            }
            catch { Console.WriteLine("{\"fixtureFailureStage\":" + stage + ",\"nativeError\":" + Marshal.GetLastWin32Error() + "}"); return 2; }
            finally
            {
                if (!cleanup) { if (main != null) try { CallerLauncherNative.Stop(main); } catch { } if (child != null) try { CallerLauncherNative.Stop(child); } catch { } }
                if (main != null) main.Dispose(); if (child != null) child.Dispose();
                if (!canary.HasExited) canary.Kill(); canary.WaitForExit(2000);
            }
        }
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
}
