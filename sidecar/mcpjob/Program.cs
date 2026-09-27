using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Private, one-shot helper. Gateway stdout starts with one helper-owned ready byte,
// then contains selected stdout. Action stdout has only the ready byte. Stderr is
// helper-owned cleanup status; selected stderr is counted and discarded.
internal static class Program
{
    private const int MaxLaunchBytes = 131072;
    private const int MaxChildStderrBytes = 32768;
    private const int MaxActionOutputBytes = 65536;

    private static int Main()
    {
        bool ready = false;
        try
        {
            Stream controlIn = Console.OpenStandardInput();
            string executable, cwd, environment;
            string[] args;
            bool action, isolated, imported;
            string inputPath, inputHash;
            int inputSize;
            string executableHash;
            int executableSize;
            ReadLaunch(controlIn, out executable, out cwd, out args, out environment,
                out action, out isolated, out imported, out inputPath, out inputSize, out inputHash,
                out executableSize, out executableHash);
#if APPCONTAINER_TEST
            if (isolated && Path.GetFileName(executable) == "mapped-executable.exe")
                AppContainerExecutable.DriveTypeForTest = delegate(string root) { return 4; };
#endif
            using (AppContainerExecutable.PinnedFile pinnedExecutable = isolated
                ? AppContainerExecutable.Open(executable, executableSize, executableHash) : null)
            using (AppContainerProfile profile = isolated ? AppContainerProfile.Create() : null)
            using (AppContainerWorkspace workspace = isolated
                ? AppContainerWorkspace.Create(cwd, profile.Sid) : null)
            {
#if APPCONTAINER_TEST
            if (imported && Path.GetFileName(inputPath) == "mapped-source.bin")
                AppContainerInput.DriveTypeForTest = delegate(string root) { return 4; };
#endif
            using (AppContainerInput.ImportedFile importedFile = imported
                ? AppContainerInput.Copy(inputPath, inputSize, inputHash, workspace, cwd) : null)
            {
#if APPCONTAINER_TEST
            // Fixture-only window for cancellation between copy and process creation.
            if (imported && Path.GetFileName(inputPath) == "pause-source.bin")
            {
                File.WriteAllText(Path.Combine(cwd, "import-pause.txt"), "ready");
                Thread.Sleep(1000);
            }
#endif
            if (!Native.ControlOpen())
            {
                if (importedFile != null && !importedFile.Remove())
                    throw new InvalidOperationException("input-cleanup-uncertain");
                throw new InvalidOperationException("launch-cancelled");
            }
            Native.Session started;
            try { started = Native.Start(executable, cwd, args, environment, profile, importedFile,
                pinnedExecutable); }
            catch
            {
                if (importedFile != null && !importedFile.Remove())
                    throw new InvalidOperationException("input-cleanup-uncertain");
                throw;
            }
            using (Native.Session session = started)
            {
                Stream controlOut = Console.OpenStandardOutput();
                controlOut.WriteByte((byte)(imported ? 'I' : isolated ? 'S' : 'R'));
                controlOut.Flush();
                ready = true;
                int stderrOverflow = 0;
                int actionOutputOverflow = 0;
                int stdoutBytes = 0, stderrBytes = 0;
                object outputLock = new object();
                Action<bool, int> countActionOutput = (standardOutput, count) =>
                {
                    lock (outputLock)
                    {
                        int remaining = Math.Max(0, MaxActionOutputBytes - stdoutBytes - stderrBytes);
                        int retained = Math.Min(remaining, count);
                        if (standardOutput) stdoutBytes += retained;
                        else stderrBytes += retained;
                        if (retained < count) Interlocked.Exchange(ref actionOutputOverflow, 1);
                    }
                };
                if (action) session.Input.Close();
                Task input = Task.Factory.StartNew(() =>
                {
                    byte[] buffer = new byte[4096];
                    try
                    {
                        int count;
                        while ((count = Native.ReadAvailable(controlIn, Native.StandardInput(), buffer)) >= 0)
                        {
                            if (count == 0) continue;
                            if (!action)
                            {
                                session.Input.Write(buffer, 0, count);
                                session.Input.Flush();
                            }
                        }
                    }
                    catch (IOException) { }
                    finally { Array.Clear(buffer, 0, buffer.Length); try { session.Input.Close(); } catch { } }
                }, TaskCreationOptions.LongRunning);
                Task output = Task.Factory.StartNew(() =>
                {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = Native.ReadAvailable(session.Output, session.Output.SafeFileHandle.DangerousGetHandle(), buffer)) >= 0)
                    {
                        if (count == 0) continue;
                        if (action)
                        {
                            countActionOutput(true, count);
                            if (Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) != 0) break;
                        }
                        else
                        {
                            controlOut.Write(buffer, 0, count);
                            controlOut.Flush();
                        }
                    }
                    Array.Clear(buffer, 0, buffer.Length);
                }, TaskCreationOptions.LongRunning);
                Task error = Task.Factory.StartNew(() =>
                {
                    byte[] buffer = new byte[4096];
                    int total = 0, count;
                    while ((count = Native.ReadAvailable(session.Error, session.Error.SafeFileHandle.DangerousGetHandle(), buffer)) >= 0)
                    {
                        if (count == 0) continue;
                        if (action)
                        {
                            countActionOutput(false, count);
                            if (Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) != 0) break;
                        }
                        else if ((total += count) > MaxChildStderrBytes)
                        {
                            Interlocked.Exchange(ref stderrOverflow, 1);
                            break;
                        }
                    }
                    Array.Clear(buffer, 0, buffer.Length);
                }, TaskCreationOptions.LongRunning);

                uint wait;
                while ((wait = Native.WaitForSingleObject(session.Process, 25)) == 0x102)
                {
                    if (input.IsCompleted || (!action && output.IsCompleted) || output.IsFaulted ||
                        error.IsFaulted ||
                        Interlocked.CompareExchange(ref stderrOverflow, 0, 0) != 0 ||
                        Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) != 0) break;
                }
                int? exitCode = action && wait == 0 && !input.IsCompleted &&
                    Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) == 0
                    ? (int?)session.ExitCode() : null;
                bool confirmed = session.TerminateAndVerify();
                bool drained = false;
                try { drained = Task.WaitAll(new Task[] { output, error }, 200); } catch { }
                bool workspaceRetained = isolated && workspace.IsRetained();
                bool profileCleanup = isolated && profile.Cleanup();
                Stream status = Console.OpenStandardError();
                if (action)
                {
                    string frame = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                        isolated
                            ? (imported ? "I,{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}\n" :
                                "S,{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}\n")
                            : "A,{0},{1},{2},{3},{4},{5},{6}\n", confirmed ? "C" : "U",
                        exitCode.HasValue ? "1" : "0",
                        exitCode.HasValue ? exitCode.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "-",
                        stdoutBytes, stderrBytes,
                        drained && Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) == 0 ? "1" : "0",
                        Interlocked.CompareExchange(ref actionOutputOverflow, 0, 0) != 0 ? "1" : "0",
                        session.IsolationVerified ? "1" : "0",
                        workspaceRetained ? "1" : "0", profileCleanup ? "1" : "0");
                    byte[] bytes = Encoding.ASCII.GetBytes(frame);
                    status.Write(bytes, 0, bytes.Length);
                }
                else status.WriteByte((byte)(confirmed ? 'C' : 'U'));
                status.Flush();
                return confirmed && (!isolated ||
                    (session.IsolationVerified && workspaceRetained && profileCleanup)) ? 0 : 2;
            }
            }
            }
        }
        catch
        {
            // Never print executable, argv, environment, cwd, child stderr or exception text.
            try
            {
                Stream channel = ready ? Console.OpenStandardError() : Console.OpenStandardOutput();
                channel.WriteByte((byte)(ready ? 'U' : 'F'));
                channel.Flush();
            }
            catch { }
            return 2;
        }
    }

    private static void ReadLaunch(Stream input, out string executable, out string cwd,
        out string[] args, out string environment, out bool action, out bool isolated,
        out bool imported, out string inputPath, out int inputSize, out string inputHash,
        out int executableSize, out string executableHash)
    {
        using (MemoryStream bytes = new MemoryStream())
        {
            while (true)
            {
                int b = input.ReadByte();
                if (b < 0 || bytes.Length >= MaxLaunchBytes) throw new InvalidDataException();
                if (b == '\n') break;
                bytes.WriteByte((byte)b);
            }
            string json = new UTF8Encoding(false, true).GetString(bytes.ToArray());
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = MaxLaunchBytes;
            Dictionary<string, object> launch = serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (launch == null || launch.Count < 4 || launch.Count > 7)
                throw new InvalidDataException();
            action = false;
            isolated = false;
            imported = false;
            inputPath = null;
            inputSize = 0;
            inputHash = null;
            executableSize = 0;
            executableHash = null;
            if (launch.Count >= 5)
            {
                object purpose;
                if (!launch.TryGetValue("purpose", out purpose) ||
                    ((purpose as string) != "action" &&
                     (purpose as string) != "appcontainer-action" &&
                     (purpose as string) != "appcontainer-action-import"))
                    throw new InvalidDataException();
                action = true;
                isolated = (purpose as string) != "action";
                imported = (purpose as string) == "appcontainer-action-import";
                if (launch.Count != (imported ? 7 : isolated ? 6 : 5))
                    throw new InvalidDataException();
                if (isolated)
                {
                    Dictionary<string, object> descriptor =
                        launch["executableSnapshot"] as Dictionary<string, object>;
                    if (descriptor == null || descriptor.Count != 3 ||
                        !(descriptor["size"] is int)) throw new InvalidDataException();
                    executableSize = (int)descriptor["size"];
                    executableHash = StringField(descriptor, "sha256");
                    if (!string.Equals(StringField(descriptor, "path"),
                        StringField(launch, "executable"), StringComparison.Ordinal))
                        throw new InvalidDataException();
                }
                if (imported)
                {
                    Dictionary<string, object> descriptor = launch["input"] as Dictionary<string, object>;
                    if (descriptor == null || descriptor.Count != 3 ||
                        !(descriptor["size"] is int)) throw new InvalidDataException();
                    inputPath = StringField(descriptor, "path");
                    inputSize = (int)descriptor["size"];
                    inputHash = StringField(descriptor, "sha256");
                }
            }
            executable = StringField(launch, "executable");
            cwd = StringField(launch, "cwd");
            if (!Path.IsPathRooted(executable) || !Path.IsPathRooted(cwd)) throw new InvalidDataException();
            object[] rawArgs = launch["args"] as object[];
            if (rawArgs == null) throw new InvalidDataException();
            args = rawArgs.Select(a => CheckedString(a)).ToArray();
            Dictionary<string, object> rawEnv = launch["env"] as Dictionary<string, object>;
            if (rawEnv == null) throw new InvalidDataException();
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, string> selectedEnv = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            StringBuilder block = new StringBuilder();
            foreach (string key in rawEnv.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
            {
                if (key.Length == 0 || key.Contains("=") || key.IndexOf('\0') >= 0 || !names.Add(key))
                    throw new InvalidDataException();
                string value = CheckedString(rawEnv[key]);
                selectedEnv.Add(key, value);
                block.Append(key).Append('=').Append(value).Append('\0');
            }
            if (isolated)
            {
                string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
                if (string.IsNullOrEmpty(systemRoot) || !Path.IsPathRooted(systemRoot) ||
                    !Matches(selectedEnv, "SystemRoot", systemRoot) ||
                    !Matches(selectedEnv, "WINDIR", systemRoot) ||
                    !Matches(selectedEnv, "TEMP", cwd) || !Matches(selectedEnv, "TMP", cwd) ||
                    !Matches(selectedEnv, "LOCALAPPDATA", cwd) ||
                    !Matches(selectedEnv, "USERPROFILE", cwd))
                    throw new InvalidDataException();
            }
            block.Append('\0');
            if (rawEnv.Count == 0) block.Append('\0');
            environment = block.ToString();
        }
    }

    private static string StringField(Dictionary<string, object> value, string name)
    {
        object raw;
        if (!value.TryGetValue(name, out raw)) throw new InvalidDataException();
        return CheckedString(raw);
    }

    private static bool Matches(Dictionary<string, string> values, string name, string expected)
    {
        string actual;
        return values.TryGetValue(name, out actual) &&
            string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
    }

    private static string CheckedString(object value)
    {
        string text = value as string;
        if (text == null || text.IndexOf('\0') >= 0) throw new InvalidDataException();
        return text;
    }
}
