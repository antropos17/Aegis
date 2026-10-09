using System;

namespace Aegis.ProtectedSession
{
    // Inactive opt-in factory. Reuse the retained Session's one-use release, contexts and cleanup.
    internal static class CallerBootstrap
    {
        internal static CallerSession Prepare(string root, int size, string hash, string label, CallerRegistration server)
        { return CallerSession.PrepareBootstrap(root, size, hash, label, server, null, new CallerBootstrapInput()); }
        internal static CallerSession PrepareForController(string root, int size, string hash, string label,
            CallerRegistration server, CallerRegistration main)
        { CallerNative.Require(main != null); return CallerSession.PrepareBootstrap(root, size, hash, label, server, null, new CallerBootstrapInput(), main); }
#if ENROLLMENT_LEASE_TEST
        internal static CallerSession PrepareForTest(string root, int size, string hash, string label,
            CallerRegistration server, IEnrollmentFiles files, CallerBootstrapInput input)
        {
            CallerNative.Require(files != null);
            return CallerSession.PrepareBootstrap(root, size, hash, label, server, files, input);
        }
        internal static CallerSession PrepareForControllerTest(string root, int size, string hash, string label,
            CallerRegistration server, CallerRegistration main, IEnrollmentFiles files, CallerBootstrapInput input)
        {
            CallerNative.Require(main != null && files != null);
            return CallerSession.PrepareBootstrap(root, size, hash, label, server, files, input, main);
        }
#endif
    }

    internal sealed partial class CallerSession
    {
        private CallerSession(CallerRegistration server, ICallerSetup transport, CallerRegistration main)
        {
            // Immutable from construction: no published owner can change its gate.
            gate = server.Gate; this.server = server; this.main = main; setup = transport;
        }
        internal static CallerSession PrepareBootstrap(string root, int size, string hash, string label,
            CallerRegistration server, IEnrollmentFiles files, CallerBootstrapInput input, CallerRegistration main = null)
        {
            CallerNative.Require(server != null && input != null);
            var result = new CallerSession(server, input, main);
            lock (result.gate)
            {
                // PrepareCore owns initial authority checks, setup and every acquired cleanup path.
                return PrepareCore(root, size, hash, label, files, input, result);
            }
        }
    }
}
