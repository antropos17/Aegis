using System;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Fixed ASCII v1 envelope. PID/birth are checked observations, never process-open selectors.
    internal sealed class CallerBootstrapFrame
    {
        internal const int Size = 144;
        internal readonly IntPtr ServerHandle;
        internal readonly uint ServerPid;
        internal readonly long ServerBirth;
        internal readonly string Locator, Session, Generation;
        private const string Prefix = "\\\\.\\pipe\\aegis-owned-caller-";
        private CallerBootstrapFrame(string value)
        {
            CallerNative.Require(IntPtr.Size == 8 && Regex.IsMatch(value, "\\AAEGISB01[a-f0-9]{136}\\z", RegexOptions.CultureInvariant));
            ServerHandle = new IntPtr(Convert.ToInt64(value.Substring(8, 16), 16));
            ServerPid = Convert.ToUInt32(value.Substring(24, 8), 16); ServerBirth = Convert.ToInt64(value.Substring(32, 16), 16);
            CallerNative.Require(ServerHandle.ToInt64() > 0 && (ServerHandle.ToInt64() & 3) == 0 && ServerPid > 0 && ServerBirth > 0);
            Locator = Prefix + value.Substring(48, 32); Session = value.Substring(80, 32); Generation = value.Substring(112, 32);
        }
        internal static CallerBootstrapFrame Parse(byte[] bytes)
        {
            CallerNative.Require(bytes.Length == Size);
            // ASCII replacement produces '?', rejected by the canonical lower-case hexadecimal grammar.
            return new CallerBootstrapFrame(Encoding.ASCII.GetString(bytes));
        }
        internal CallerRegistration ImportServer()
        {
            using (var imported = new SafeFileHandle(ServerHandle, true))
            {
                CallerEndpointNative.RequireNonInherited(imported);
                // Its Generation is independent. The envelope generation belongs to the parent's child registration.
                return new CallerRegistration(imported.DangerousGetHandle(), Session, ServerPid, ServerBirth);
            }
        }
    }

    internal sealed partial class CallerRegistration
    {
        internal byte[] ExportBootstrap(SafeFileHandle child, CallerSession.RoutingLabels routing)
        {
            lock (Gate)
            {
                CheckCurrent();
                IntPtr remote = CallerBootstrapInput.DuplicateServer(process, child);
                CheckCurrent();
                return Encoding.ASCII.GetBytes("AEGISB01" + remote.ToInt64().ToString("x16") + pid.ToString("x8") + birth.ToString("x16") +
                    routing.Locator.Substring("\\\\.\\pipe\\aegis-owned-caller-".Length) + routing.Session + routing.Generation);
            }
        }
    }
}
