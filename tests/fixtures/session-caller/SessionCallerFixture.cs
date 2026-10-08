using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class SessionCallerFixture
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint openMode, uint pipeMode,
        uint instances, uint output, uint input, uint timeout, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteFile(SafeFileHandle pipe, byte[] bytes, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AdjustTokenPrivileges(SafeFileHandle token, bool disableAll, ref PrivilegeChange change, uint size, IntPtr previous, IntPtr returned);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateTokenEx(SafeFileHandle token, uint access, IntPtr attributes, int level, int type, out SafeFileHandle copy);
    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenStatistics
    {
        internal Luid TokenId, Authentication; internal long Expiration; internal int Type, Level;
        internal uint Charged, Available, Groups, Privileges; internal Luid Modified;
    }
    [StructLayout(LayoutKind.Sequential, Pack = 4)] private struct PrivilegeChange
    { internal uint Count; internal Luid Luid; internal uint Attributes; }

    private sealed class Mutation
    {
        internal uint Before, After;
        internal uint RestoredAttributes;
        internal bool PidSame, BirthSame, SidSame, LogonSame, TokenIdSame, ModifiedChanged, Restored, FinalModifiedChanged;
        internal string Json()
        {
            return ",\"mutated\":true,\"privilegeBefore\":" + Before + ",\"privilegeAfter\":" + After +
                ",\"pidSame\":" + Flag(PidSame) + ",\"birthSame\":" + Flag(BirthSame) +
                ",\"sidSame\":" + Flag(SidSame) + ",\"logonSame\":" + Flag(LogonSame) +
                ",\"tokenIdSame\":" + Flag(TokenIdSame) + ",\"modifiedChanged\":" + Flag(ModifiedChanged) +
                ",\"restored\":" + Flag(Restored) + ",\"restoredAttributes\":" + RestoredAttributes +
                ",\"finalModifiedChanged\":" + Flag(FinalModifiedChanged);
        }
    }
    private static string Flag(bool value) { return value.ToString().ToLowerInvariant(); }
    private static bool SameLuid(Luid first, Luid second) { return first.Low == second.Low && first.High == second.High; }
    private static T Query<T>(SafeFileHandle token, int kind, Func<IntPtr, int, T> read)
    {
        int length;
        bool sized = CallerNative.GetTokenInformation(token, kind, IntPtr.Zero, 0, out length);
        CallerNative.Require(!sized && Marshal.GetLastWin32Error() == 122 && length >= 4 && length <= 65536);
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try {
            int returned;
            CallerNative.Require(CallerNative.GetTokenInformation(token, kind, buffer, length, out returned) && returned >= 4 && returned <= length);
            return read(buffer, returned);
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static TokenStatistics Statistics(SafeFileHandle token)
    {
        return Query(token, 10, (buffer, length) => {
            CallerNative.Require(length == Marshal.SizeOf(typeof(TokenStatistics)));
            return (TokenStatistics)Marshal.PtrToStructure(buffer, typeof(TokenStatistics));
        });
    }
    private static uint Privilege(SafeFileHandle token, Luid luid)
    {
        return Query(token, 3, (buffer, length) => {
            uint count = unchecked((uint)Marshal.ReadInt32(buffer));
            CallerNative.Require(count <= 256 && 4L + count * 12L == length);
            for (int index = 0; index < count; index++) {
                int offset = 4 + index * 12;
                var observed = new Luid { Low = unchecked((uint)Marshal.ReadInt32(buffer, offset)), High = Marshal.ReadInt32(buffer, offset + 4) };
                if (SameLuid(observed, luid)) return unchecked((uint)Marshal.ReadInt32(buffer, offset + 8));
            }
            throw new InvalidOperationException("fixture-privilege-unavailable");
        });
    }
    private static PrivilegeChange DisabledPrivilege(SafeFileHandle token)
    {
        return Query(token, 3, (buffer, length) => {
            uint count = unchecked((uint)Marshal.ReadInt32(buffer));
            CallerNative.Require(count > 0 && count <= 256 && 4L + count * 12L == length);
            for (int index = 0; index < count; index++) {
                int offset = 4 + index * 12; uint attributes = unchecked((uint)Marshal.ReadInt32(buffer, offset + 8));
                if ((attributes & 2) == 0) return new PrivilegeChange { Count = 1,
                    Luid = new Luid { Low = unchecked((uint)Marshal.ReadInt32(buffer, offset)), High = Marshal.ReadInt32(buffer, offset + 4) },
                    Attributes = attributes | 2U };
            }
            throw new InvalidOperationException("fixture-disabled-privilege-unavailable");
        });
    }
    // Changes only an already-present enabled privilege in this disposable child.
    private static Mutation DisableChildPrivilege(Process child, bool restore)
    {
        SafeFileHandle token;
        CallerNative.Require(OpenProcessToken(child.Handle, 0x28, out token));
        using (token)
        using (var process = CallerNative.Duplicate(child.Handle)) {
            Luid luid; CallerNative.Require(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out luid));
            var before = Statistics(token); uint attributes = Privilege(token, luid);
            string sidBefore;
            using (var identity = new System.Security.Principal.WindowsIdentity(token.DangerousGetHandle())) sidBefore = identity.User.Value;
            uint pid = CallerNative.GetProcessId(process); long birth, exit, kernel, user;
            CallerNative.Require(CallerNative.GetProcessTimes(process, out birth, out exit, out kernel, out user) && (attributes & 2) != 0);
            var change = new PrivilegeChange { Count = 1, Luid = luid, Attributes = attributes & ~2U };
            CallerNative.Require(AdjustTokenPrivileges(token, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
            var after = Statistics(token); uint changed = Privilege(token, luid); string sidAfter;
            using (var identity = new System.Security.Principal.WindowsIdentity(token.DangerousGetHandle())) sidAfter = identity.User.Value;
            long afterBirth; CallerNative.Require(CallerNative.GetProcessTimes(process, out afterBirth, out exit, out kernel, out user));
            var result = new Mutation { Before = attributes, After = changed, PidSame = pid == CallerNative.GetProcessId(process),
                BirthSame = birth == afterBirth && birth > 0, SidSame = sidBefore == sidAfter,
                LogonSame = SameLuid(before.Authentication, after.Authentication), TokenIdSame = SameLuid(before.TokenId, after.TokenId),
                ModifiedChanged = !SameLuid(before.Modified, after.Modified) };
            CallerNative.Require(changed == change.Attributes && changed != attributes && result.PidSame && result.BirthSame &&
                result.SidSame && result.LogonSame && result.TokenIdSame && result.ModifiedChanged);
            if (restore) {
                change.Attributes = attributes;
                CallerNative.Require(AdjustTokenPrivileges(token, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
                result.RestoredAttributes = Privilege(token, luid);
                TokenStatistics final = Statistics(token);
                result.Restored = result.RestoredAttributes == attributes && SameLuid(before.TokenId, final.TokenId) && SameLuid(before.Authentication, final.Authentication);
                result.FinalModifiedChanged = !SameLuid(before.Modified, final.Modified);
                CallerNative.Require(result.Restored && result.FinalModifiedChanged && !SameLuid(after.Modified, final.Modified));
            }
            return result;
        }
    }

    private static int TokenEquivalence()
    {
        using (var self = Process.GetCurrentProcess()) {
            SafeFileHandle token, primary, peer;
            CallerNative.Require(OpenProcessToken(self.Handle, 0xA, out token));
            using (token) {
                var original = CallerIdentity.Observe(token); var stats = Statistics(token);
                CallerNative.Require(DuplicateTokenEx(token, 8, IntPtr.Zero, 2, 1, out primary));
                using (primary) {
                    var copy = CallerIdentity.Observe(primary);
                    bool tokenIdDifferent = !SameLuid(stats.TokenId, Statistics(primary).TokenId);
                    CallerNative.Require(tokenIdDifferent && !original.SamePrimaryToken(copy));
                }
                CallerNative.Require(DuplicateTokenEx(token, 0x28, IntPtr.Zero, 2, 2, out peer));
                using (peer) {
                    var peerStats = Statistics(peer); var observed = CallerIdentity.Observe(peer);
                    bool peerIdDifferent = !SameLuid(stats.TokenId, peerStats.TokenId);
                    bool equivalent = original.MatchesImpersonation(observed);
                    Luid luid; CallerNative.Require(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out luid));
                    uint before = Privilege(peer, luid); CallerNative.Require((before & 2) != 0);
                    var change = new PrivilegeChange { Count = 1, Luid = luid, Attributes = before & ~2U };
                    CallerNative.Require(AdjustTokenPrivileges(peer, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
                    bool peerChanged = Privilege(peer, luid) == change.Attributes && !SameLuid(peerStats.Modified, Statistics(peer).Modified);
                    bool changedEquivalent = original.MatchesImpersonation(CallerIdentity.Observe(peer));
                    change.Attributes = before;
                    CallerNative.Require(AdjustTokenPrivileges(peer, false, ref change, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
                    bool restoredPeerEquivalent = original.MatchesImpersonation(CallerIdentity.Observe(peer));
                    var introduced = DisabledPrivilege(token);
                    uint disabled = Privilege(peer, introduced.Luid);
                    CallerNative.Require((disabled & 2) == 0 &&
                        AdjustTokenPrivileges(peer, false, ref introduced, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0);
                    bool introducedObserved = Privilege(peer, introduced.Luid) == (disabled | 2U);
                    bool introducedRejected = !original.MatchesImpersonation(CallerIdentity.Observe(peer));
                    bool primaryUnchanged = original.SamePrimaryToken(CallerIdentity.Observe(token));
                    Console.WriteLine("{\"primaryCopyRejected\":true,\"peerTokenIdDifferent\":" + Flag(peerIdDifferent) +
                        ",\"peerEquivalent\":" + Flag(equivalent) + ",\"peerPrivilegeChanged\":" + Flag(peerChanged) +
                        ",\"changedPeerEquivalent\":" + Flag(changedEquivalent) + ",\"restoredPeerEquivalent\":" + Flag(restoredPeerEquivalent) +
                        ",\"introducedEnabledObserved\":" + Flag(introducedObserved) + ",\"introducedEnabledRejected\":" + Flag(introducedRejected) +
                        ",\"primaryUnchanged\":" + Flag(primaryUnchanged) + "}");
                }
            }
        }
        return 0;
    }

    // Synthetic OS-style buffers exercise the actual native parser without
    // claiming these allocations are independently issued token observations.
    private static int BufferFixture(string mode)
    {
        IntPtr buffer = Marshal.AllocHGlobal(256);
        try {
            Marshal.Copy(new byte[256], 0, buffer, 256);
            bool group = mode.StartsWith("buffer-groups-", StringComparison.Ordinal);
            int length = group ? 72 : 28;
            Marshal.WriteInt32(buffer, 2);
            if (group) {
                for (int index = 0; index < 2; index++) {
                    byte[] sid = new byte[16];
                    new System.Security.Principal.SecurityIdentifier(index == 0 ? "S-1-5-32-545" : "S-1-5-32-544").GetBinaryForm(sid, 0);
                    Marshal.Copy(sid, 0, IntPtr.Add(buffer, 40 + index * 16), sid.Length);
                    Marshal.WriteIntPtr(buffer, 8 + index * 16, IntPtr.Add(buffer, 40 + index * 16));
                    Marshal.WriteInt32(buffer, 16 + index * 16, 7);
                }
            } else {
                Marshal.WriteInt32(buffer, 4, 23); Marshal.WriteInt32(buffer, 12, 3);
                Marshal.WriteInt32(buffer, 16, 20); Marshal.WriteInt32(buffer, 24, 0);
            }
            string[] before = group ? CallerIdentity.ReadGroups(buffer, length) : CallerIdentity.ReadPrivileges(buffer, length);
            if (mode == "buffer-privileges-empty") {
                Marshal.WriteInt32(buffer, 0);
                Console.WriteLine("{\"syntheticBuffers\":true,\"emptyParsed\":" + Flag(CallerIdentity.ReadPrivileges(buffer, 16).Length == 0) + "}");
                return 0;
            }
            if (mode.EndsWith("-order", StringComparison.Ordinal)) {
                int offset = group ? 8 : 4, stride = group ? 16 : 12;
                byte[] entries = new byte[stride * 2]; Marshal.Copy(IntPtr.Add(buffer, offset), entries, 0, entries.Length);
                Marshal.Copy(entries, stride, IntPtr.Add(buffer, offset), stride);
                Marshal.Copy(entries, 0, IntPtr.Add(buffer, offset + stride), stride);
                string[] after = group ? CallerIdentity.ReadGroups(buffer, length) : CallerIdentity.ReadPrivileges(buffer, length);
                bool equal = String.Join("|", before) == String.Join("|", after);
                Marshal.WriteInt32(buffer, group ? 16 : 12, group ? 5 : 2);
                string[] changed = group ? CallerIdentity.ReadGroups(buffer, length) : CallerIdentity.ReadPrivileges(buffer, length);
                Console.WriteLine("{\"syntheticBuffers\":true,\"orderIndependent\":" + Flag(equal) +
                    ",\"attributeChangeObserved\":" + Flag(String.Join("|", before) != String.Join("|", changed)) + "}");
                return 0;
            }
            switch (mode) {
                case "buffer-groups-null": break;
                case "buffer-groups-short": case "buffer-privileges-short": length = 3; break;
                case "buffer-groups-count": case "buffer-privileges-count": Marshal.WriteInt32(buffer, 257); break;
                case "buffer-groups-table": length = 39; break;
                case "buffer-groups-pointer-before": Marshal.WriteIntPtr(buffer, 8, IntPtr.Subtract(buffer, 1)); break;
                case "buffer-groups-pointer-table": Marshal.WriteIntPtr(buffer, 8, IntPtr.Add(buffer, 8)); break;
                case "buffer-groups-pointer-end": Marshal.WriteIntPtr(buffer, 8, IntPtr.Add(buffer, length)); break;
                case "buffer-groups-sid-truncated": Marshal.WriteIntPtr(buffer, 8, IntPtr.Add(buffer, length - 8)); Marshal.WriteByte(buffer, length - 8, 1); Marshal.WriteByte(buffer, length - 7, 2); break;
                case "buffer-groups-sid-count": Marshal.WriteByte(buffer, 41, 16); break;
                case "buffer-groups-sid-revision": Marshal.WriteByte(buffer, 40, 2); break;
                case "buffer-groups-duplicate": Marshal.WriteIntPtr(buffer, 24, Marshal.ReadIntPtr(buffer, 8)); break;
                case "buffer-privileges-truncated": length = 27; break;
                case "buffer-privileges-empty-truncated": Marshal.WriteInt32(buffer, 0); length = 15; break;
                case "buffer-privileges-duplicate": Marshal.WriteInt32(buffer, 16, 23); break;
                default: throw new InvalidOperationException("fixture-mode-invalid");
            }
            bool rejected = false;
            try {
                if (group) CallerIdentity.ReadGroups(mode == "buffer-groups-null" ? IntPtr.Zero : buffer, length);
                else CallerIdentity.ReadPrivileges(buffer, length);
            } catch (InvalidOperationException) { rejected = true; }
            Console.WriteLine("{\"syntheticBuffers\":true,\"rejected\":" + Flag(rejected) + "}");
            return 0;
        } finally { Marshal.FreeHGlobal(buffer); }
    }

    private sealed class FailureNative : CallerNative
    {
        private readonly string mode;
        internal bool ImpersonationAttempted, TokenQueried, ReversionAttempted, FatalObserved;
        internal uint PeerPrivileges;
        internal FailureNative(string selected) { mode = selected; }
        internal override bool Impersonate(SafeHandle pipe)
        { ImpersonationAttempted = true; return mode != "impersonation-failure" && base.Impersonate(pipe); }
        internal override SafeFileHandle ThreadToken()
        {
            TokenQueried = true;
            if (mode == "query-failure") throw new InvalidOperationException();
            SafeFileHandle token = base.ThreadToken();
            try { PeerPrivileges = PrivilegeCount(token); return token; }
            catch { token.Dispose(); throw; }
        }
        internal override bool Revert()
        {
            ReversionAttempted = true;
            // Really revert the fixture thread even when injecting a false API result.
            bool reverted = base.Revert();
            return mode != "revert-failure" && reverted;
        }
        internal override void RevertFailure() { FatalObserved = true; throw new InvalidOperationException("fixture-revert-failure"); }
    }

    private static Process StartChild()
    {
        return Process.Start(new ProcessStartInfo {
            FileName = typeof(SessionCallerFixture).Assembly.Location, Arguments = "client",
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        });
    }

    private static byte[] Frame(string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        byte[] frame = new byte[body.Length + 4];
        Buffer.BlockCopy(BitConverter.GetBytes(body.Length), 0, frame, 0, 4);
        Buffer.BlockCopy(body, 0, frame, 4, body.Length);
        return frame;
    }

    private static uint PrivilegeCount(SafeFileHandle token)
    {
        return Query(token, 3, (buffer, length) => {
            uint count = unchecked((uint)Marshal.ReadInt32(buffer));
            CallerNative.Require(count <= 256 && (count == 0 ? length == 16 : 4L + count * 12L == length)); return count;
        });
    }
    private static Stream ConnectClient(string name, string mode)
    {
        if (mode == "effective-only") {
            // Explicit SQOS: impersonation with disabled privileges filtered by the OS.
            SafeFileHandle pipe = CreateFile("\\\\.\\pipe\\" + name, 0xC0000000, 0,
                IntPtr.Zero, 3, 0x001A0000, IntPtr.Zero);
            try { CallerNative.Require(!pipe.IsInvalid); return new FileStream(pipe, FileAccess.ReadWrite, 4096, false); }
            catch { pipe.Dispose(); throw; }
        }
        var managed = new NamedPipeClientStream(".", name, PipeDirection.InOut,
            PipeOptions.None, System.Security.Principal.TokenImpersonationLevel.Impersonation);
        try { managed.Connect(3000); return managed; } catch { managed.Dispose(); throw; }
    }

    private static void Supply(Process child, string pipe, CallerRegistration registration, string mode)
    {
        child.StandardInput.WriteLine(pipe);
        child.StandardInput.WriteLine(registration.Generation);
        child.StandardInput.WriteLine(registration.Session);
        child.StandardInput.WriteLine(mode);
        child.StandardInput.Flush();
    }

    private static void CloseChild(Process child)
    {
        if (child == null) return;
        try { if (!child.HasExited) child.Kill(); child.WaitForExit(3000); }
        finally { child.Dispose(); }
    }

    private static int Client()
    {
        string name = Console.ReadLine(), generation = Console.ReadLine(), session = Console.ReadLine(), mode = Console.ReadLine();
        using (Stream pipe = ConnectClient(name, mode))
        {
            string json = "{\"protocol\":\"aegis-supervisor-caller\",\"version\":1,\"operation\":\"inspect-owned\"," +
                "\"requestId\":\"" + new string('a', 32) + "\",\"sessionId\":\"" + session +
                "\",\"generation\":\"" + generation + "\",\"sequence\":1}";
            if (mode == "malformed") json = "{}";
            if (mode == "oversize") json = new string('x', 4097);
            if (mode == "wrong-generation") json = json.Replace(generation, new string('f', 32));
            if (mode == "forged-pid") json = json.Replace("\"sequence\":1", "\"sequence\":1,\"pid\":" + Process.GetCurrentProcess().Id);
            byte[] frame = Frame(json);
            if (mode == "partial") frame = new byte[] { 1, 0 };
            if (mode == "invalid-utf8") frame = new byte[] { 2, 0, 0, 0, 0xc0, 0xaf };
            if (mode == "extra-frame") {
                byte[] twice = new byte[frame.Length * 2];
                Buffer.BlockCopy(frame, 0, twice, 0, frame.Length);
                Buffer.BlockCopy(frame, 0, twice, frame.Length, frame.Length);
                frame = twice;
            }
            pipe.Write(frame, 0, frame.Length);
            pipe.Flush();
            return pipe.ReadByte() == 1 ? 0 : 3;
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "client") { try { return Client(); } catch { return 4; } }
        if (args.Length != 1) return 2;
        string mode = args[0];
        if (mode == "token-equivalence") { try { return TokenEquivalence(); } catch { return 2; } }
        if (mode.StartsWith("buffer-", StringComparison.Ordinal)) { try { return BufferFixture(mode); } catch { return 2; } }
        Process registeredChild = null, sibling = null;
        CallerRegistration registration = null;
        try
        {
            string name = "aegis-caller-fixture-" + Guid.NewGuid().ToString("N");
            using (SafeFileHandle pipe = CreateNamedPipe("\\\\.\\pipe\\" + name,
                3 | 0x00080000, 4 | 2 | 8, 1, 8192, 8192, 2000, IntPtr.Zero))
            {
                CallerNative.Require(!pipe.IsInvalid);
                registeredChild = StartChild();
                // Controlled initial token setup precedes the sole registration,
                // ensuring at least one disabled privilege for a portable SQOS case.
                Mutation setup = mode == "effective-only" ? DisableChildPrivilege(registeredChild, false) : null;
                registration = new CallerRegistration(registeredChild.Handle, new string('b', 32));
                uint primaryPrivileges;
                using (var held = CallerNative.Duplicate(registeredChild.Handle))
                using (var token = CallerNative.ProcessToken(held))
                    primaryPrivileges = PrivilegeCount(token);
                if (mode == "server-positive" || mode == "server-mismatch")
                {
                    using (var self = Process.GetCurrentProcess())
                    using (var serverRegistration = new CallerRegistration(self.Handle, new string('b', 32)))
                    {
                        bool accepted = false;
                        Task peer = Task.Factory.StartNew(() => {
                            using (var client = new NamedPipeClientStream(".", name, PipeDirection.InOut)) {
                                client.Connect(3000);
                                try { (mode == "server-positive" ? serverRegistration : registration).VerifyServer(client.SafePipeHandle);
                                    accepted = true;
                                } catch (InvalidOperationException) { }
                            }
                        });
                        CallerNative.Require(ConnectNamedPipe(pipe, IntPtr.Zero) || Marshal.GetLastWin32Error() == 535);
                        CallerNative.Require(peer.Wait(4000));
                        Console.WriteLine("{\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"reverted\":true,\"contextRevoked\":false}");
                        return 0;
                    }
                }
                Process clientChild = registeredChild;
                if (mode == "sibling" || mode == "exited") {
                    if (mode == "exited") { registeredChild.Kill(); CallerNative.Require(registeredChild.WaitForExit(3000)); }
                    sibling = StartChild(); clientChild = sibling;
                }
                if (mode == "disposed") registration.Dispose();
                Mutation mutation = mode == "privilege-before-admission" || mode == "privilege-restored" ?
                    DisableChildPrivilege(registeredChild, mode == "privilege-restored") : null;
                bool registrationRejected = false;
                if (mutation != null) {
                    try { registration.CheckCurrent(); } catch (InvalidOperationException) { registrationRejected = true; }
                }
                Supply(clientChild, name, registration, mode);
                CallerNative.Require(ConnectNamedPipe(pipe, IntPtr.Zero) || Marshal.GetLastWin32Error() == 535);
                bool admitted = false, contextRevoked = false;
                var observations = new FailureNative(mode);
                try
                {
                    var context = CallerAdmission.ReadAndAuthenticate(pipe, registration, observations);
                    context.CheckCurrent();
                    admitted = true;
                    if (mode == "privilege-after-admission") {
                        mutation = DisableChildPrivilege(registeredChild, false);
                        try { registration.CheckCurrent(); } catch (InvalidOperationException) { registrationRejected = true; }
                        try { context.CheckCurrent(); } catch (InvalidOperationException) { contextRevoked = true; }
                    }
                    if (mode == "revoke-context") {
                        registration.Dispose();
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                    if (mode == "disconnect-context") {
                        clientChild.Kill(); CallerNative.Require(clientChild.WaitForExit(3000));
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                    if (mode == "expired-context") {
                        System.Threading.Thread.Sleep(2100);
                        try { context.CheckCurrent(); }
                        catch (InvalidOperationException) { contextRevoked = true; }
                    }
                }
                catch (Exception error) {
                    if (!(error is InvalidOperationException) && !(error is InvalidDataException) && !(error is DecoderFallbackException)) throw;
                }
                uint written;
                WriteFile(pipe, new byte[] { admitted ? (byte)1 : (byte)0 }, 1, out written, IntPtr.Zero);
                CallerNative.Require(clientChild.WaitForExit(3000));
                CallerNative.Require(mode == "disconnect-context" || clientChild.ExitCode == (admitted ? 0 : 3));
                Console.WriteLine("{\"accepted\":" + admitted.ToString().ToLowerInvariant() +
                    ",\"reverted\":" + (!CallerNative.HasThreadToken()).ToString().ToLowerInvariant() +
                    ",\"contextRevoked\":" + contextRevoked.ToString().ToLowerInvariant() +
                    ",\"impersonationAttempted\":" + observations.ImpersonationAttempted.ToString().ToLowerInvariant() +
                    ",\"tokenQueried\":" + observations.TokenQueried.ToString().ToLowerInvariant() +
                    ",\"reversionAttempted\":" + observations.ReversionAttempted.ToString().ToLowerInvariant() +
                    ",\"fatalReversionObserved\":" + observations.FatalObserved.ToString().ToLowerInvariant() +
                    ",\"registrationRejected\":" + Flag(registrationRejected) +
                    (mode == "effective-only" ? ",\"initialPrivilegeDisabled\":" + Flag(setup != null) +
                        ",\"primaryPrivilegeCount\":" + primaryPrivileges + ",\"peerPrivilegeCount\":" + observations.PeerPrivileges : "") +
                    (mutation == null ? "" : mutation.Json()) + "}");
                return 0;
            }
        }
        catch { return 2; }
        finally { if (registration != null) registration.Dispose(); CloseChild(sibling); CloseChild(registeredChild); }
    }
}
