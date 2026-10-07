using System;
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
        private readonly Luid authentication;
        private readonly int session, restrictions, restrictedSids, appContainer, elevation, uiAccess, mandatoryPolicy;
        internal readonly int Type, Level;

        private CallerIdentity(SafeFileHandle token)
        {
            sid = Sid(token, 1);
            integrity = Sid(token, 25);
            Statistics statistics = Value<Statistics>(token, 10);
            authentication = statistics.Authentication;
            Type = statistics.Type;
            Level = statistics.Level;
            session = Value<int>(token, 12);
            // TokenHasRestrictions is a native BOOLEAN (one byte on Windows).
            restrictions = WithBuffer(token, 21, (buffer, length) => (int)Marshal.ReadByte(buffer));
            restrictedSids = Value<int>(token, 11);
            appContainer = Value<int>(token, 29);
            elevation = Value<int>(token, 20);
            uiAccess = Value<int>(token, 26);
            mandatoryPolicy = Value<int>(token, 27);
            CallerNative.Require(sid != "S-1-5-7" && (Type == 1 || Type == 2));
        }

        internal static CallerIdentity Observe(SafeFileHandle token) { return new CallerIdentity(token); }

        internal bool SameContext(CallerIdentity other)
        {
            return sid == other.sid && integrity == other.integrity &&
                authentication.Low == other.authentication.Low && authentication.High == other.authentication.High &&
                session == other.session && restrictions == other.restrictions && restrictedSids == other.restrictedSids && appContainer == other.appContainer &&
                elevation == other.elevation && uiAccess == other.uiAccess && mandatoryPolicy == other.mandatoryPolicy;
        }

        internal bool PermittedBroker()
        {
            // This increment supports a regular, non-AppContainer broker only. A
            // protected dedicated principal is still a separate provisioning gate.
            return Type == 1 && restrictedSids == 0 && appContainer == 0 && uiAccess == 0 &&
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
                CallerNative.Require(length >= IntPtr.Size);
                return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
            });
        }
    }
}
