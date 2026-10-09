using System;

namespace Aegis.ProtectedSession
{
    // Inactive opt-in factory. Reuse the retained Session's one-use release, contexts and cleanup.
    internal static class CallerBootstrap
    {
        internal static CallerSession Prepare(string root, int size, string hash, string label, CallerRegistration server)
        { return CallerSession.PrepareBootstrap(root, size, hash, label, server, null, new CallerBootstrapInput()); }
#if ENROLLMENT_LEASE_TEST
        internal static CallerSession PrepareForTest(string root, int size, string hash, string label,
            CallerRegistration server, IEnrollmentFiles files, CallerBootstrapInput input)
        {
            CallerNative.Require(files != null);
            return CallerSession.PrepareBootstrap(root, size, hash, label, server, files, input);
        }
#endif
    }

    internal sealed partial class CallerSession
    {
        private CallerSession(CallerRegistration server, IDisposable transport, Action check)
        {
            // Immutable from construction: no published owner can change its gate.
            gate = server.Gate; bootstrapServer = server; bootstrapInput = transport; bootstrapCheck = check;
        }
        internal static CallerSession PrepareBootstrap(string root, int size, string hash, string label,
            CallerRegistration server, IEnrollmentFiles files, CallerBootstrapInput input)
        {
            CallerNative.Require(server != null && input != null);
            var result = new CallerSession(server, input, input.CheckCurrent);
            lock (result.gate)
            {
                try
                {
                    server.CheckCurrent();
                    // Supply only re-enters this identical held gate; transport check takes no owner locks or callbacks.
                    return PrepareCore(root, size, hash, label, files, input, result,
                        owner => input.Supply(server, owner.Routing));
                }
                catch { result.Close(); throw; }
            }
        }
    }
}
