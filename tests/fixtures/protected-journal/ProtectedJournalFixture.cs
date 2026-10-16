using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using Aegis.ProtectedSession;

internal static class ProtectedJournalFixture
{
    public static int Main(string[] args)
    {
        try
        {
            if (args[0] == "production")
            {
                foreach (Type type in new[] { typeof(ProtectedJournalNative), typeof(ProtectedJournalLease), typeof(ProtectedJournalRegistration) })
                    foreach (MethodInfo method in type.GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
                        if (method.Name.Contains("ForTest")) throw new Exception("production-test-seam");
                Console.WriteLine("{\"production\":true,\"effects\":0}"); return 0;
            }
            if (args[0] == "parse")
            {
                try { ProtectedJournalRegistration.Parse(File.ReadAllBytes(args[1])); Console.WriteLine("{\"accepted\":true}"); }
                catch { Console.WriteLine("{\"accepted\":false}"); }
                return 0;
            }
#if PROTECTED_JOURNAL_TEST
            if (args[0] == "owner-dispose-race") { OwnerDisposeRace(args[1]); return 0; }
            Native(args[0], args[1], args[2]); return 0;
#else
            throw new Exception("fixture-mode-unavailable");
#endif
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
#if PROTECTED_JOURNAL_TEST
    private static void Check(bool value) { if (!value) throw new Exception("journal-contract-failed"); }
    private static bool Refuses(Action action) { try { action(); return false; } catch { return true; } }
    private static ProtectedOperationBinding Binding()
    { return new ProtectedOperationBinding(new string('a', 32), 1, new string('b', 32), new string('f', 64), new string('c', 32), new string('d', 32),
        Guid.Parse("11111111-1111-4111-8111-111111111111"), new string('1', 64), VmConfigurationProfile.Name, new string('2', 64), new string('3', 32), new string('4', 32)); }
    private static byte[] Record(ProtectedOperationBinding binding, Guid id, ProtectedOperationPhase phase, uint sequence, string head)
    { return ProtectedOperationRecord.CreateForTest(binding, new VmOperationRecord(id, binding.VmId, 2, null, null, true), phase, sequence, head).Encode(); }
    private static void Native(string mode, string source, string directory)
    {
        byte[] bytes = File.ReadAllBytes(source);
        if (mode == "foreign-directory" || mode == "foreign-file" || mode == "foreign-security")
        {
            string field = mode == "foreign-directory" ? "directoryFileId" : mode == "foreign-file" ? "fileId" : "fileSecuritySha256";
            string text = Encoding.UTF8.GetString(bytes); int start = text.IndexOf("\"" + field + "\":\"", StringComparison.Ordinal) + field.Length + 4;
            text = text.Substring(0, start) + (text[start] == 'a' ? "b" : "a") + text.Substring(start + 1); bytes = Encoding.UTF8.GetBytes(text);
        }
        var registration = ProtectedJournalRegistration.Parse(bytes); var binding = Binding();
        string path = Path.Combine(directory, registration.Leaf); Guid operation = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        byte[] first = Record(binding, operation, ProtectedOperationPhase.RecordedIntent, 1, ProtectedOperationRecord.ZeroHash);
        if (mode == "protection")
        { Check(Refuses(delegate { using (var refused = ProtectedJournalNative.AcquireForTest(registration, directory, true)) { } })); Done(0, 0); return; }
        if (mode == "nonempty") File.WriteAllText(path, "{", Encoding.ASCII);
        if (mode == "wrong-file") { File.Delete(path); File.WriteAllBytes(path, new byte[0]); }
        if (mode == "two-stage") File.WriteAllText(Path.Combine(directory, "unassociated.jsonl"), "", Encoding.ASCII);
        if (mode == "wrong-file" || mode == "two-stage" || mode.StartsWith("foreign-", StringComparison.Ordinal))
        { Check(Refuses(delegate { using (var refused = ProtectedJournalNative.AcquireForTest(registration, directory, false)) { } })); Done(0, 0); return; }
        var native = ProtectedJournalNative.AcquireForTest(registration, directory, false); bool valid = true; var ownerGate = new object(); var callerGate = new object();
        ProtectedJournalLease lease = null;
        try
        {
            if (mode == "nonempty")
            { Check(Refuses(delegate { lease = ProtectedJournalLease.CreateForTest(ownerGate, delegate { }, registration, binding, native); })); Done(0, 0); return; }
            lease = ProtectedJournalLease.CreateForTest(ownerGate, callerGate, delegate { if (!valid) throw new InvalidOperationException(); }, registration, binding, native);
            int header = native.ReadAll().Length; Check(header > 0 && header <= 2048);
            if (mode == "exclusive")
            { Check(Refuses(delegate { using (var writer = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } })); Check(Refuses(delegate { File.Delete(path); })); Done(header, 0); return; }
            if (mode == "chunks") native.WriteChunkForTest = 7;
            if (mode == "append-dispose-race")
            {
                using (var entered = new ManualResetEvent(false))
                using (var release = new ManualResetEvent(false))
                using (var disposalStarted = new ManualResetEvent(false))
                {
                    Exception appendError = null, disposalError = null; ProtectedJournalAcknowledgment issued = null;
                    native.DuringWriteForTest = delegate { entered.Set(); Check(release.WaitOne(3000)); };
                    var appender = new Thread(delegate() { try { issued = lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); } catch (Exception error) { appendError = error; } });
                    var disposer = new Thread(delegate() { try { disposalStarted.Set(); lock (ownerGate) valid = false; lease.Dispose(); } catch (Exception error) { disposalError = error; } });
                    appender.Start(); Check(entered.WaitOne(3000)); disposer.Start(); Check(disposalStarted.WaitOne(3000)); release.Set();
                    Check(appender.Join(3000) && disposer.Join(3000) && appendError == null && disposalError == null && issued != null);
                    Check(Refuses(delegate { issued.CheckCurrent(lease); })); Done(header, native.NativeWritesForTest); return;
                }
            }
            if (mode == "caller-dispose-race")
            {
                Exception error = null; Thread appender;
                lock (callerGate)
                {
                    appender = new Thread(delegate() { try { lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); } catch (Exception caught) { error = caught; } });
                    appender.Start(); valid = false;
                }
                Check(appender.Join(3000) && error != null);
                Done(header, native.NativeWritesForTest); return;
            }
            if (mode == "owner-loss") valid = false;
            if (mode == "prefix") native.CorruptPrefixForTest();
            if (mode == "zero" || mode == "write" || mode == "after-write" || mode == "flush" || mode == "readback") native.FaultForTest = mode;
            if (mode == "reentry") native.DuringWriteForTest = delegate { Check(Refuses(delegate { lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); })); };
            if (mode == "dispose") lease.Dispose();
            if (mode == "bad-head")
            { Check(Refuses(delegate { lease.Append(first, 0, new string('f', 64)); })); Done(header, native.NativeWritesForTest); return; }
            if (mode == "illegal-phase") first = Record(binding, operation, ProtectedOperationPhase.SettledSuccess, 1, ProtectedOperationRecord.ZeroHash);
            if (mode != "positive" && mode != "chunks" && mode != "reopen" && mode != "ack")
            {
                Check(Refuses(delegate { lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); })); valid = true; native.FaultForTest = null; native.DuringWriteForTest = null;
                Check(Refuses(delegate { lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); })); Done(header, native.NativeWritesForTest); return;
            }
            var ack = lease.Append(first, 0, ProtectedOperationRecord.ZeroHash); Check(ack.Sequence == 1); ack.CheckCurrent(lease);
            string head = ProtectedOperationRecord.Parse(first).RecordSha256;
            byte[] consumed = Record(binding, operation, ProtectedOperationPhase.DurablyConsumed, 2, head);
            var consumedAck = lease.Append(consumed, 1, head); Check(consumedAck.Sequence == 2);
            Check(lease.Inspect(operation, ProtectedOperationRecord.Parse(first).OperationSha256).Unknown);
            if (mode == "chunks") Check(native.NativeWritesForTest > 2);
            if (mode == "ack") Check(Refuses(delegate { ack.CheckCurrent(null); }));
            int writes = native.NativeWritesForTest;
            lease.Dispose(); Check(Refuses(delegate { ack.CheckCurrent(lease); }));
            if (mode == "reopen")
            {
                using (var reopened = ProtectedJournalNative.AcquireForTest(registration, directory, false))
                    Check(Refuses(delegate { ProtectedJournalLease.CreateForTest(new object(), delegate { }, registration, binding, reopened); }));
            }
            Done(header, writes);
        }
        finally { if (lease != null) lease.Dispose(); native.Dispose(); }
    }
    private static void Done(int header, int writes)
    { Console.WriteLine("{\"passed\":true,\"effects\":0,\"modeledProtection\":true,\"headerBytes\":" + header + ",\"nativeWriteCalls\":" + writes + "}"); }
    private static void OwnerDisposeRace(string root)
    {
        using (var process = Process.GetCurrentProcess())
        using (var server = new CallerRegistration(process.Handle, new string('a', 32)))
        using (var policy = InstalledOwnerPolicy.CreateForTest(root, new string('a', 32), 1, new string('b', 32), "S-1-5-21-1",
            new string('c', 32), new string('d', 32), new string('f', 64), 1, new string('1', 64), 1, new string('2', 64)))
        using (var owner = InstalledOwnerRegistration.CreateForTest(policy, server, process.Handle, delegate { }))
        {
            Exception failure = null; Thread disposer;
            lock (server.Gate)
            {
                disposer = new Thread(delegate() { try { owner.Dispose(); } catch (Exception caught) { failure = caught; } }); disposer.Start();
                var watch = Stopwatch.StartNew(); bool closed = false;
                while (watch.ElapsedMilliseconds < 3000 && !(closed = Refuses(owner.CheckCurrent))) Thread.Yield();
                Check(closed); Check(Refuses(owner.Dispose));
            }
            Check(disposer.Join(3000) && failure == null); owner.Dispose(); Done(0, 0);
        }
    }
#endif
}
