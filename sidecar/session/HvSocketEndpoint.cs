using System;

namespace Aegis.ProtectedSession
{
    // A destination and observed socket address, never a runtime authority.
    internal sealed class HvSocketEndpoint
    {
        internal static readonly Guid ServiceId = new Guid("6f958f4e-7436-4a0a-9c04-33f639f6b565");
        internal readonly Guid VmId;
        internal HvSocketEndpoint(Guid vmId)
        {
            foreach (string reserved in new string[] {
                "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "90db8b89-0d35-4f79-8ce9-49ea0ac8b7cd", "e0e16197-dd56-4a10-9195-5ee7a155a838",
                "a42e7cda-d03f-480c-9cc2-a4de20abb878"
            }) Require(vmId != new Guid(reserved));
            VmId = vmId;
        }
        internal byte[] Address()
        {
            byte[] value = new byte[36]; value[0] = 34;
            Buffer.BlockCopy(VmId.ToByteArray(), 0, value, 4, 16);
            Buffer.BlockCopy(ServiceId.ToByteArray(), 0, value, 20, 16);
            return value;
        }
        internal void CheckPeer(byte[] address)
        {
            Require(address != null && address.Length == 36 && address[0] == 34 &&
                address[1] == 0 && address[2] == 0 && address[3] == 0);
            byte[] expected = Address();
            try
            {
                int difference = 0;
                for (int index = 0; index < expected.Length; index++) difference |= expected[index] ^ address[index];
                Require(difference == 0);
            }
            finally { Array.Clear(expected, 0, expected.Length); }
        }
        private static void Require(bool value)
        { if (!value) throw new InvalidOperationException("hv-transport-unavailable"); }
    }
}
