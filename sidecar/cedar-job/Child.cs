using System.Runtime.InteropServices;
using System.Text;

internal sealed class Child : IDisposable
{
    internal nint Process, Input, Output, Error;
    internal uint Id;

    internal void Start(OwnedJob job, string runtime, string entry, string operation = "")
    {
        var child = this; // Assigned to the outer owner before creation, including failed starts.
        nint inputRead = 0, outputWrite = 0, errorWrite = 0, list = 0, handles = 0, jobs = 0, env = 0;
        Native.ProcessInfo process = default;
        bool initialized = false;
        try
        {
            var security = new Native.Security { Length = Marshal.SizeOf<Native.Security>(), Inherit = 1 };
            Native.Check(Native.CreatePipe(out inputRead, out child.Input, ref security, 0));
            Native.Check(Native.CreatePipe(out child.Output, out outputWrite, ref security, 0));
            Native.Check(Native.CreatePipe(out child.Error, out errorWrite, ref security, 0));
            Native.Check(Native.SetHandleInformation(child.Input, 1, 0));
            Native.Check(Native.SetHandleInformation(child.Output, 1, 0));
            Native.Check(Native.SetHandleInformation(child.Error, 1, 0));
            nuint size = 0;
            Native.InitializeProcThreadAttributeList(0, 2, 0, ref size);
            Native.Check(size > 0);
            list = Marshal.AllocHGlobal(checked((nint)size));
            Native.Check(Native.InitializeProcThreadAttributeList(list, 2, 0, ref size));
            initialized = true;
            handles = Marshal.AllocHGlobal(nint.Size * 3);
            Marshal.WriteIntPtr(handles, 0, inputRead);
            Marshal.WriteIntPtr(handles, nint.Size, outputWrite);
            Marshal.WriteIntPtr(handles, nint.Size * 2, errorWrite);
            Native.Check(Native.UpdateProcThreadAttribute(list, 0, 0x20002, handles, (nuint)(nint.Size * 3), 0, 0));
            jobs = Marshal.AllocHGlobal(nint.Size);
            Marshal.WriteIntPtr(jobs, job.Handle);
            Native.Check(Native.UpdateProcThreadAttribute(list, 0, 0x2000D, jobs, (nuint)nint.Size, 0, 0));
            var startup = new Native.StartupEx
            {
                Info = new Native.Startup { Size = Marshal.SizeOf<Native.StartupEx>(), Flags = 0x100, Input = inputRead, Output = outputWrite, Error = errorWrite },
                Attributes = list
            };
            // No inherited Node/.NET hooks, debug, profile, credential or arbitrary env values.
            string system = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string environment = $"ELECTRON_RUN_AS_NODE=1\0SystemRoot={system}\0WINDIR={system}\0\0";
            env = Marshal.StringToHGlobalUni(environment);
#if CEDAR_JOB_FIXTURE
            string arguments = Quote("--inert-" + operation);
#else
            string arguments = "--no-addons --max-old-space-size=96 " + Quote(entry);
#endif
            // CREATE_SUSPENDED + atomic Job-list assignment; never break away or retry.
            Program.CheckRunning();
            job.VerifyParentHierarchy();
            Native.Check(Native.CreateProcess(runtime, new StringBuilder(Quote(runtime) + " " + arguments), 0, 0, true,
                0x4 | 0x08000000 | 0x400 | 0x80000, env, Path.GetDirectoryName(runtime)!, ref startup, out process));
            child.Process = process.Process; process.Process = 0;
            child.Id = process.Id;
            job.VerifyChildMembership(child.Process);
#if CEDAR_JOB_FIXTURE
            if (operation == "caps-corrupt") job.CorruptForFixture();
#endif
            job.VerifyLimits(); // Re-query every cap with the child still suspended.
            Native.Check(job.Verified);
#if CEDAR_JOB_FIXTURE
            if (operation == "suspended")
            {
                Native.Check(Native.GetProcessTimes(child.Process, out long creation, out _, out _, out _));
                Protocol.Write(Console.OpenStandardOutput(), new { fixtureReady = child.Id, originalCreationTime = creation,
                    suspended = true, ownership = job.Observation(child.Process) });
                while (Program.ControlOpen()) Thread.Sleep(5);
                throw new InvalidOperationException("cedar-owner-lost");
            }
            if (operation == "resume-refusal") throw new InvalidOperationException("cedar-resume-refused");
            if (operation == "revoked-suspended") Program.MarkStopped(2);
            if (operation == "expired-suspended") Program.ExpireForFixture();
#endif
            job.ResumeVerified(process.Thread, child.Process);
        }
        finally
        {
            Native.Close(ref process.Thread); Native.Close(ref process.Process);
            Native.Close(ref inputRead); Native.Close(ref outputWrite); Native.Close(ref errorWrite);
            if (initialized) Native.DeleteProcThreadAttributeList(list);
            if (list != 0) Marshal.FreeHGlobal(list);
            if (handles != 0) Marshal.FreeHGlobal(handles);
            if (jobs != 0) Marshal.FreeHGlobal(jobs);
            if (env != 0) Marshal.FreeHGlobal(env);
        }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    public void Dispose()
    {
        Native.Close(ref Input); Native.Close(ref Output); Native.Close(ref Error); Native.Close(ref Process);
    }
}
