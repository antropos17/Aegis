using System;
using System.IO;
using System.Threading.Tasks;

namespace Aegis.ProtectedSession
{
    // Inactive, unelevated protocol entrypoint. Creates no agent or host resources.
    internal static class Program
    {
        private const int InputDeadlineMs = 2000;

        private static int Main(string[] arguments)
        {
            if (arguments.Length != 0) return 2;
            try
            {
                Stream input = Console.OpenStandardInput();
                Task<Protocol.Request> read = Task.Factory.StartNew(
                    () => Protocol.Read(input), TaskCreationOptions.LongRunning);
                if (!read.Wait(InputDeadlineMs)) return 2;
                Protocol.Request request = read.Result;
                Protocol.WriteUnavailable(Console.OpenStandardOutput(), request);
                return request.Operation == "probe" ? 0 : 3;
            }
            catch
            {
                // Fixed exit code; no untrusted input or exception text is echoed.
                return 2;
            }
        }
    }
}
