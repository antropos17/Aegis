using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal sealed class CallerIdentity
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct Luid { internal uint Low; internal int High; }
        [StructLayout(LayoutKind.Sequential)]
        private struct Statistics
        {
            internal Luid TokenId, Authentication;
            internal long Expiration;
            internal int Type, Level;
            internal uint Charged, Available, Groups, Privileges;
            internal Luid Modified;
        }
        private readonly string sid, integrity;
        private readonly Luid authentication, tokenId, modified;
        private readonly string[] groups, privileges, restricting;
        private readonly int session, restrictions, appContainer, elevation, uiAccess, mandatoryPolicy;
        internal readonly int Type, Level;

        private CallerIdentity(SafeFileHandle token)
        {
            Statistics statistics = Value<Statistics>(token, 10);
            sid = Sid(token, 1);
            integrity = Sid(token, 25);
            authentication = statistics.Authentication;
            tokenId = statistics.TokenId;
            modified = statistics.Modified;
            Type = statistics.Type;
            Level = statistics.Level;
            session = Value<int>(token, 12);
            // TokenHasRestrictions is a native BOOLEAN (one byte on Windows).
            restrictions = WithBuffer(token, 21, (buffer, length) => (int)Marshal.ReadByte(buffer));
            groups = WithBuffer(token, 2, ReadGroups);
            privileges = WithBuffer(token, 3, ReadPrivileges);
            restricting = WithBuffer(token, 11, ReadGroups);
            appContainer = Value<int>(token, 29);
            elevation = Value<int>(token, 20);
            uiAccess = Value<int>(token, 26);
            mandatoryPolicy = Value<int>(token, 27);
            CallerNative.Require(sid != "S-1-5-7" && (Type == 1 || Type == 2));
            Statistics after = Value<Statistics>(token, 10);
            // Reject a mixed snapshot. ModifiedId also catches change-and-restore.
            CallerNative.Require(SameLuid(tokenId, after.TokenId) && SameLuid(modified, after.Modified) &&
                SameLuid(authentication, after.Authentication) && Type == after.Type &&
                (Type == 1 || Level == after.Level) && statistics.Groups == groups.Length &&
                statistics.Privileges == privileges.Length && after.Groups == statistics.Groups &&
                after.Privileges == statistics.Privileges);
        }

        internal static CallerIdentity Observe(SafeFileHandle token) { return new CallerIdentity(token); }

        private static bool SameLuid(Luid first, Luid second)
        { return first.Low == second.Low && first.High == second.High; }
        private static bool SameEntries(string[] first, string[] second)
        {
            if (first.Length != second.Length) return false;
            for (int index = 0; index < first.Length; index++)
                if (!String.Equals(first[index], second[index], StringComparison.Ordinal)) return false;
            return true;
        }
        private static bool SamePeerPrivileges(string[] primary, string[] peer)
        {
            // Effective-only pipe tokens may omit disabled privileges. Every
            // supplied entry must match, and every enabled entry must remain.
            // ReadPrivileges already provides unique ordinally sorted snapshots.
            foreach (string entry in peer)
                if (Array.BinarySearch(primary, entry, StringComparer.Ordinal) < 0) return false;
            foreach (string entry in primary)
                if ((Convert.ToUInt32(entry.Substring(17), 16) & 2) != 0 &&
                    Array.BinarySearch(peer, entry, StringComparer.Ordinal) < 0) return false;
            return true;
        }
        private bool SameContext(CallerIdentity other, bool pipePeer)
        {
            return SameOperator(other) && integrity == other.integrity &&
                restrictions == other.restrictions && appContainer == other.appContainer &&
                elevation == other.elevation && uiAccess == other.uiAccess && mandatoryPolicy == other.mandatoryPolicy &&
                SameEntries(groups, other.groups) &&
                (pipePeer ? SamePeerPrivileges(privileges, other.privileges) : SameEntries(privileges, other.privileges)) &&
                SameEntries(restricting, other.restricting);
        }

        internal bool SamePrimaryToken(CallerIdentity other)
        {
            return other != null && Type == 1 && other.Type == 1 && SameLuid(tokenId, other.tokenId) &&
                SameLuid(modified, other.modified) && SameContext(other, false);
        }
        internal bool SameOperator(CallerIdentity other)
        {
            // Operator tuple only; native registration and peer matching enforce token type separately.
            return other != null && sid == other.sid &&
                SameLuid(authentication, other.authentication) && session == other.session;
        }
        internal string OperatorSid { get { return sid; } }
        internal string OperatorAuthentication
        { get { return (((ulong)unchecked((uint)authentication.High) << 32) | authentication.Low).ToString("x16"); } }
        internal uint OperatorSession { get { CallerNative.Require(session >= 0); return (uint)session; } }
        internal bool MatchesOperator(string selectedSid, string selectedAuthentication, uint selectedSession)
        { return sid == selectedSid && OperatorAuthentication == selectedAuthentication && session >= 0 && (uint)session == selectedSession; }
        internal bool MatchesImpersonation(CallerIdentity other)
        {
            // The pipe impersonation token is a distinct native object. Its own
            // snapshot is stable, but its TokenId/ModifiedId need not equal ours.
            return other != null && Type == 1 && other.Type == 2 && other.Level == 2 && SameContext(other, true);
        }

        internal bool PermittedBroker()
        {
            // This increment supports a regular, non-AppContainer broker only. A
            // protected dedicated principal is still a separate provisioning gate.
            return Type == 1 && restricting.Length == 0 && appContainer == 0 && uiAccess == 0 &&
                (integrity == "S-1-16-8192" || integrity == "S-1-16-8448" ||
                 integrity == "S-1-16-12288" || integrity == "S-1-16-16384");
        }

        private static T WithBuffer<T>(SafeFileHandle token, int kind, Func<IntPtr, int, T> read)
        {
            int length;
            bool first = CallerNative.GetTokenInformation(token, kind, IntPtr.Zero, 0, out length);
            int error = Marshal.GetLastWin32Error();
            // TokenElevation reports ERROR_BAD_LENGTH on the inbox runtime;
            // variable-sized classes use ERROR_INSUFFICIENT_BUFFER.
            CallerNative.Require(!first && (error == 122 || error == 24) && length >= 1 && length <= 65536);
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try
            {
                int returned;
                CallerNative.Require(CallerNative.GetTokenInformation(token, kind, buffer, length, out returned) &&
                    returned >= 1 && returned <= length);
                return read(buffer, returned);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static T Value<T>(SafeFileHandle token, int kind)
        {
            return WithBuffer(token, kind, (buffer, length) => {
                CallerNative.Require(length >= Marshal.SizeOf(typeof(T)));
                return (T)Marshal.PtrToStructure(buffer, typeof(T));
            });
        }

        private static string Sid(SafeFileHandle token, int kind)
        {
            return WithBuffer(token, kind, (buffer, length) => {
                // SID_AND_ATTRIBUTES: pointer, DWORD attributes, then native alignment padding.
                int header = 2 * IntPtr.Size;
                CallerNative.Require(length >= header);
                return ReadSid(buffer, length, Marshal.ReadIntPtr(buffer), header);
            });
        }
        private static string ReadSid(IntPtr buffer, int length, IntPtr sidPointer, int minimum)
        {
            long start = buffer.ToInt64(), address = sidPointer.ToInt64(), end = checked(start + length);
            CallerNative.Require(buffer != IntPtr.Zero && start > 0 && minimum >= 0 && minimum <= length &&
                address >= checked(start + minimum) && address <= end - 8);
            int count = Marshal.ReadByte(sidPointer, 1), bytes = 8 + count * 4;
            CallerNative.Require(Marshal.ReadByte(sidPointer) == 1 && count <= 15 && bytes <= end - address);
            return new SecurityIdentifier(sidPointer).Value;
        }
        // Internal parsing seams accept bounded OS-style buffers, never authority.
        internal static string[] ReadGroups(IntPtr buffer, int length)
        {
            CallerNative.Require(buffer != IntPtr.Zero && length >= 4 && length <= 65536);
            uint count = unchecked((uint)Marshal.ReadInt32(buffer));
            // TOKEN_GROUPS aligns its first SID_AND_ATTRIBUTES to pointer width.
            int offset = IntPtr.Size, stride = 2 * IntPtr.Size;
            CallerNative.Require(count <= 256 && (count == 0 || offset + (long)count * stride <= length));
            int tableEnd = checked(offset + (int)count * stride);
            var entries = new string[count]; var unique = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < count; index++) {
                int item = offset + index * stride;
                string value = ReadSid(buffer, length, Marshal.ReadIntPtr(buffer, item), tableEnd);
                CallerNative.Require(unique.Add(value));
                uint attributes = unchecked((uint)Marshal.ReadInt32(buffer, item + IntPtr.Size));
                entries[index] = value + ":" + attributes.ToString("x8");
            }
            Array.Sort(entries, StringComparer.Ordinal); return entries;
        }
        internal static string[] ReadPrivileges(IntPtr buffer, int length)
        {
            CallerNative.Require(buffer != IntPtr.Zero && length >= 4 && length <= 65536);
            uint count = unchecked((uint)Marshal.ReadInt32(buffer));
            // Windows returns the fixed one-slot TOKEN_PRIVILEGES header even
            // when an effective-only token has no privileges.
            CallerNative.Require(count <= 256 && (count == 0 ? length == 16 : 4L + count * 12L == length));
            var entries = new string[count]; var unique = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < count; index++) {
                int offset = 4 + index * 12;
                string value = unchecked((uint)Marshal.ReadInt32(buffer, offset + 4)).ToString("x8") +
                    unchecked((uint)Marshal.ReadInt32(buffer, offset)).ToString("x8");
                CallerNative.Require(unique.Add(value));
                entries[index] = value + ":" + unchecked((uint)Marshal.ReadInt32(buffer, offset + 8)).ToString("x8");
            }
            Array.Sort(entries, StringComparer.Ordinal); return entries;
        }
    }
}
