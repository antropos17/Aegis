using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Disposable stand-in for the packaged Electron process. It exercises the
// actual verifier and process ancestry, but is not an Electron runtime test.
internal static class FakeElectron
{
    private const string Challenge="0123456789abcdef0123456789abcdef";
    private static void Need(bool ok,string reason) { if(!ok) throw new Exception(reason); }
    private static string ReadReply(Stream read,Stream write,int timeout) {
        var elapsed=Stopwatch.StartNew(); while(elapsed.ElapsedMilliseconds<timeout) {
            string frame=OwnerWire.Read(read,timeout-(int)elapsed.ElapsedMilliseconds);
            if(frame.StartsWith("P ",StringComparison.Ordinal)) {OwnerWire.Write(write,"Q "+frame.Substring(2),1000);continue;}
            return frame;
        } throw new TimeoutException();
    }
    private static int Main(string[] args)
    {
        if(args.Length==1 && args[0]=="--fixture-stuck") { System.Threading.Thread.Sleep(30000); return 0; }
        string dir=Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        string scenario=args.Length>2 && args[2].StartsWith("policy path ") && args[2].EndsWith("\\") ? args[2].Substring(12,args[2].Length-13) : "invalid";
        try {
            Need(args.Length==5 && args[0]==Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"resources","app.asar","src","main","main.js") && args[1]=="--action-mcp-delete-review" && scenario!="invalid" && args[3]=="request path" && args[4]=="endpoint path" && Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")=="1","launcher argument quoting and node entrypoint");
            foreach(string key in new[]{"NODE_OPTIONS","NODE_DEBUG","NODE_DEBUG_NATIVE","DOTNET_STARTUP_HOOKS","COREHOST_TRACE","NODE_V8_COVERAGE","AEGIS_TEST_CANARY","PATH"}) Need(Environment.GetEnvironmentVariable(key)==null,"environment whitelist "+key);
            string pipe=Environment.GetEnvironmentVariable("AEGIS_OWNER_PIPE"), secret=Environment.GetEnvironmentVariable("AEGIS_OWNER_SECRET");
            Environment.SetEnvironmentVariable("AEGIS_OWNER_PIPE",null); Environment.SetEnvironmentVariable("AEGIS_OWNER_SECRET",null);
            if(scenario=="wrong-secret") secret=Convert.ToBase64String(new byte[32]);
            string exe=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"resources","sidecar","aegis-owner-console.exe");
            var start=new ProcessStartInfo(exe,"--verify"); start.UseShellExecute=false; start.CreateNoWindow=true; start.RedirectStandardInput=true; start.RedirectStandardOutput=true; start.RedirectStandardError=true;
            start.EnvironmentVariables.Clear();
            foreach(string key in new[]{"SystemRoot","WINDIR","TEMP","TMP"}) { string value=Environment.GetEnvironmentVariable(key); if(!String.IsNullOrEmpty(value))start.EnvironmentVariables[key]=value; }
            start.EnvironmentVariables["AEGIS_OWNER_PIPE"]=pipe; start.EnvironmentVariables["AEGIS_OWNER_SECRET"]=secret;
            using(var verifier=Process.Start(start)) {
                var read=verifier.StandardOutput.BaseStream; var write=verifier.StandardInput.BaseStream;
                Need(ReadReply(read,write,10000)=="H 1","verifier ready");
                File.WriteAllText(Path.Combine(dir,scenario+".phase"),"READY");
                if(scenario=="stuck-descendant") {
                    var extra=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--fixture-stuck"); extra.UseShellExecute=false; extra.CreateNoWindow=true;
                    using(var descendant=Process.Start(extra)) {
                        File.WriteAllText(Path.Combine(dir,scenario+".pid"),descendant.Id.ToString());
                        var deadline=Stopwatch.StartNew(); while(!File.Exists(Path.Combine(dir,scenario+".release")) && deadline.ElapsedMilliseconds<5000) System.Threading.Thread.Sleep(20);
                        Need(File.Exists(Path.Combine(dir,scenario+".release")),"descendant release");
                    }
                }
                if(scenario=="verifier-death") { verifier.Kill(); Need(verifier.WaitForExit(5000),"verifier death"); File.WriteAllText(Path.Combine(dir,scenario+".result"),"PASS verifier-death cleanup"); return 0; }
                if(scenario=="wrong-ack" || scenario=="duplicate-ack" || scenario=="partial-input") {
                    if(scenario=="partial-input") {write.WriteByte(4);write.WriteByte(0);write.Flush();}
                    string probe=OwnerWire.Read(read,5000); Need(probe.StartsWith("P ",StringComparison.Ordinal),"heartbeat");
                    if(scenario=="wrong-ack") {string wrong=probe.Substring(2)==new string('0',32)?new string('f',32):new string('0',32);OwnerWire.Write(write,"Q "+wrong,1000);}
                    if(scenario=="duplicate-ack") {OwnerWire.Write(write,"Q "+probe.Substring(2),1000);OwnerWire.Write(write,"Q "+probe.Substring(2),1000);}
                    Need(verifier.WaitForExit(6000) && verifier.ExitCode==2,"invalid or absent heartbeat acknowledgement");
                    File.WriteAllText(Path.Combine(dir,scenario+".result"),"PASS "+scenario+" failed closed"); return 0;
                }
                if(scenario=="approve" || scenario=="after" || scenario=="cancel" || scenario=="cancel-wait" || scenario=="output-loss") {
                    string preview=File.ReadAllText(Path.Combine(dir,"actual-preview.b64"));
                    OwnerWire.Write(write,"R "+Challenge+" "+preview,5000);
                    if(scenario=="output-loss") { verifier.StandardOutput.Close(); bool exited=verifier.WaitForExit(8000); Need(exited && verifier.ExitCode==2,"output loss exited="+exited+(exited?" code="+verifier.ExitCode:"")); }
                    else if(scenario=="cancel" || scenario=="cancel-wait") { if(scenario=="cancel-wait") System.Threading.Thread.Sleep(1000); OwnerWire.Write(write,"C "+Challenge,5000); Need(ReadReply(read,write,5000)=="K "+Challenge,"cancellation acknowledgment"); }
                    else {
                        Need(ReadReply(read,write,8000)=="A "+Challenge,"approval");
                        if(scenario=="after") { File.WriteAllText(Path.Combine(dir,scenario+".phase"),"APPROVED"); Need(ReadReply(read,write,5000)=="V "+Challenge,"post-approval revocation"); }
                        else if(scenario=="approve") { string guard="fedcba9876543210fedcba9876543210"; OwnerWire.Write(write,"G "+guard,1000); Need(ReadReply(read,write,3000)=="Y "+guard,"fresh precommit check"); }
                    }
                }
                if(scenario=="idle") Need(ReadReply(read,write,5000)=="L","idle revocation");
                if(scenario=="approve" || scenario=="shutdown" || scenario=="stuck-descendant") { OwnerWire.Write(write,"S",5000); Need(ReadReply(read,write,5000)=="B","shutdown acknowledgment"); }
                Need(verifier.WaitForExit(5000) && verifier.ExitCode==((scenario=="idle" || scenario=="after" || scenario=="output-loss")?2:0),"verifier exit");
            }
            File.WriteAllText(Path.Combine(dir,scenario+".result"),"PASS "+scenario+" full native launch/bootstrap/shutdown"); return 0;
        } catch(Exception e) { File.WriteAllText(Path.Combine(dir,scenario+".failure"),e.Message); return 2; }
    }
}
