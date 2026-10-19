using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Aegis.HookPrivateBackup;

internal static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Blob { internal uint Size; internal IntPtr Data; }

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref Blob input, IntPtr description,
        IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref Blob input, IntPtr description,
        IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);

    internal static unsafe byte[] Transform(byte[] source, bool protect)
    {
        Blob output = default;
        fixed (byte* pointer = source)
        {
            var input = new Blob { Size = (uint)source.Length, Data = (IntPtr)pointer };
            try
            {
                // UI_FORBIDDEN = 1; no LOCAL_MACHINE (4), description, entropy or prompt.
                bool success = protect
                    ? CryptProtectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output)
                    : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
                int max = protect ? PrivateBackupStore.MaxCiphertext : PrivateBackupStore.MaxPlaintext;
                if (!success || output.Size == 0 || output.Size > max || output.Data == IntPtr.Zero)
                    throw new StoreFailure(BackupStatus.CryptoFailure);
                byte[] result = new byte[output.Size];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally
            {
                if (output.Data != IntPtr.Zero)
                {
                    if (output.Size <= PrivateBackupStore.MaxCiphertext)
                        CryptographicOperations.ZeroMemory(new Span<byte>((void*)output.Data, (int)output.Size));
                    Native.LocalFree(output.Data);
                }
            }
        }
    }
}
