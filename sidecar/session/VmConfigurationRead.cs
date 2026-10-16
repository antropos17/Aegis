using System;

namespace Aegis.ProtectedSession
{
    // Shared production/fixture fence. Provider DTOs remain untrusted until the
    // profile validator accepts them and a fresh original identity is observed.
    internal static class VmConfigurationRead
    {
        internal static VmConfigurationObservation Observe(Guid id, string identity,
            Func<VmObservation> fence, Func<VmConfigurationData> read)
        {
            Check(fence(), id, identity);
            VmConfigurationObservation result = VmConfigurationProfile.Validate(read(), id, identity);
            Check(fence(), id, identity);
            return result;
        }

        private static void Check(VmObservation observed, Guid id, string identity)
        {
            if (observed == null || id == Guid.Empty || identity == null || observed.VmId != id ||
                observed.Identity != identity || observed.State != 3)
                throw new InvalidOperationException("installed-vm-configuration-unavailable");
        }
    }
}
