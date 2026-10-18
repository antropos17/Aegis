using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;

namespace Aegis.EtwLifecycle;

// Temporary, same-logon, fixed-image qualification launch bridge; never a cleanup authority.
// There is no ETW, arbitrary executable, file writer, termination, service or policy API here.
internal static class FileQualificationHost
{
    internal static async Task Offer(Stream pipe, FileMainWitness witness, CancellationToken token)
    {
        await FileGuardWire.Write(pipe, witness, token);
        var ack = await FileGuardWire.Read<FileGuardCommand>(pipe, token);
        if (ack.kind != "accepted" || ack.handle != null || ack.guid != null) throw new InvalidDataException();
        // DisconnectNamedPipe discards unread data. FlushAsync alone cannot prove
        // that the normal caller received and verified the deposited reference.
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint pid);
    internal static async Task<int> Run(string[] args)
    {
        if (!Security.Current().Elevated) return 3;
        FileQualificationPolicy.OrdinaryDirectory(args[4]);
        using var launcher = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, int.Parse(args[2]));
        using var bootstrap = Security.Client(args[1]);
        Security.Verify(bootstrap, launcher, int.Parse(args[2]), ulong.Parse(args[3]), false, false);
        string id = Guid.NewGuid().ToString("N"); var self = Security.Current();
        using var server = Security.Server(id);
        if (!Security.RestrictedAcl(server)) return 3;
        using var lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(40));
        var children = new List<Process>();
        Task stop = Task.Run(async () =>
        {
            try { var command = await FileGuardWire.Read<FileGuardCommand>(bootstrap, lifetime.Token);
                if (command.kind != "finish" || command.handle != null || command.guid != null) throw new InvalidDataException(); }
            finally { lifetime.Cancel(); }
        });
        try
        {
            await FileGuardWire.Write(bootstrap, new FileQualificationReady($"{id}:{self.Pid}:{self.Birth}"), lifetime.Token);
            int attempts = 0;
            while (!lifetime.IsCancellationRequested && attempts++ < 128 && children.Count < 64)
            {
                try
                {
                    await server.WaitForConnectionAsync(lifetime.Token);
                    using var request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                    request.CancelAfter(TimeSpan.FromSeconds(5));
                    if (!GetNamedPipeClientProcessId(server.SafePipeHandle, out uint pid) || pid == 0 || pid > int.MaxValue) throw new UnauthorizedAccessException();
                    using var client = FileMainHandles.OpenProcess(0x101040, false, (int)pid);
                    if (client.IsInvalid || FileMainHandles.Gone(client)) throw new UnauthorizedAccessException();
                    var peer = Security.Observe(client, (int)pid);
                    Security.Verify(server, client, (int)pid, peer.Birth, true, false);
                    int mainPid = FileMainParent.ParentId((int)pid);
                    using var main = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, mainPid);
                    var mainIdentity = Security.Observe(main, mainPid);
                    using var verified = FileMainParent.ObserveMain((int)pid, mainPid, mainIdentity.Birth);
                    if (mainIdentity.Birth >= peer.Birth || FileMainHandles.Gone(launcher)) throw new UnauthorizedAccessException();
                    var value = await FileGuardWire.Read<FileQualificationRequest>(server, request.Token);
                    FileQualificationPolicy.Validate(value.args, args[4], peer.Pid, peer.Birth);
                    if (value.args.Length == 11) FileQualificationPolicy.OrdinaryDirectory(value.args[6]);
                    request.Token.ThrowIfCancellationRequested();
                    var info = Program.Child(value.args);
                    info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
                    info.Environment.Remove(FileQualificationPolicy.Variable);
                    info.Environment["AEGIS_ETW_QUALIFICATION_CHILD"] = "1";
                    var child = Process.Start(info) ?? throw new IOException(); children.Add(child);
                    var witness = FileMainHandles.Deposit(client, child.SafeHandle, child.Id);
                    // An ambiguous delivery is never remotely closed/retried. At worst the
                    // authenticated normal client retains one query-only reference until exit.
                    await Offer(server, witness, request.Token);
                }
                catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { break; }
                catch { /* Reject this connection without broadening launch authority. */ }
                finally { if (server.IsConnected) server.Disconnect(); }
            }
        }
        finally
        {
            lifetime.Cancel();
            try { await stop; } catch { }
        }
        long until = Stopwatch.GetTimestamp();
        while (children.Any(c => !c.HasExited) && Stopwatch.GetElapsedTime(until).TotalSeconds < 25) await Task.Delay(100);
        int live = children.Count(c => !c.HasExited);
        using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try { await FileGuardWire.Write(bootstrap, new FileQualificationFinished(children.Count, live,
            children.Where(c => c.HasExited).Select(c => c.ExitCode).ToArray()), finish.Token); }
        finally { foreach (var child in children) child.Dispose(); }
        return live == 0 ? 0 : 2;
    }
}
