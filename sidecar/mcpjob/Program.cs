using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Private, one-shot gateway helper. Its stdout starts with one helper-owned ready byte,
// then contains only the selected process's stdout. Its stderr contains only one
// helper-owned final cleanup byte. Child stderr is counted and discarded.
internal static class Program
{
    private const int MaxLaunchBytes = 131072;
    private const int MaxChildStderrBytes = 32768;

    private static int Main()
    {
        bool ready = false;
        try
        {
            Stream controlIn = Console.OpenStandardInput();
            string executable, cwd, environment;
            string[] args;
            ReadLaunch(controlIn, out executable, out cwd, out args, out environment);
            using (Native.Session session = Native.Start(executable, cwd, args, environment))
            {
                Stream controlOut = Console.OpenStandardOutput();
                controlOut.WriteByte((byte)'R');
                controlOut.Flush();
                ready = true;
                int stderrOverflow = 0;
                Task input = Task.Factory.StartNew(() =>
                {
                    byte[] buffer = new byte[4096];
                    try
                    {
                        int count;
                        while ((count = Native.ReadAvailable(controlIn, Native.StandardInput(), buffer)) >= 0)
                        {
                            if (count == 0) continue;
                            session.Input.Write(buffer, 0, count);
                            session.Input.Flush();
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
                        controlOut.Write(buffer, 0, count);
                        controlOut.Flush();
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
                        total += count;
                        if (total > MaxChildStderrBytes)
                        {
                            Interlocked.Exchange(ref stderrOverflow, 1);
                            break;
                        }
                    }
                    Array.Clear(buffer, 0, buffer.Length);
                }, TaskCreationOptions.LongRunning);

                while (Native.WaitForSingleObject(session.Process, 25) == 0x102)
                {
                    if (input.IsCompleted || output.IsCompleted || error.IsFaulted ||
                        Interlocked.CompareExchange(ref stderrOverflow, 0, 0) != 0) break;
                }
                bool confirmed = session.TerminateAndVerify();
                try { Task.WaitAll(new Task[] { output, error }, 200); } catch { }
                Stream status = Console.OpenStandardError();
                status.WriteByte((byte)(confirmed ? 'C' : 'U'));
                status.Flush();
                return confirmed ? 0 : 2;
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
        out string[] args, out string environment)
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
            if (launch == null || launch.Count != 4) throw new InvalidDataException();
            executable = StringField(launch, "executable");
            cwd = StringField(launch, "cwd");
            if (!Path.IsPathRooted(executable) || !Path.IsPathRooted(cwd)) throw new InvalidDataException();
            object[] rawArgs = launch["args"] as object[];
            if (rawArgs == null) throw new InvalidDataException();
            args = rawArgs.Select(a => CheckedString(a)).ToArray();
            Dictionary<string, object> rawEnv = launch["env"] as Dictionary<string, object>;
            if (rawEnv == null) throw new InvalidDataException();
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            StringBuilder block = new StringBuilder();
            foreach (string key in rawEnv.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
            {
                if (key.Length == 0 || key.Contains("=") || key.IndexOf('\0') >= 0 || !names.Add(key))
                    throw new InvalidDataException();
                block.Append(key).Append('=').Append(CheckedString(rawEnv[key])).Append('\0');
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

    private static string CheckedString(object value)
    {
        string text = value as string;
        if (text == null || text.IndexOf('\0') >= 0) throw new InvalidDataException();
        return text;
    }
}
