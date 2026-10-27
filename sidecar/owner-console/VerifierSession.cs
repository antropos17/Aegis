using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Threading;

internal static class VerifierSession
{
    private const int LifetimeMs=15*60*1000;
    private sealed class Message { internal string Value; internal bool Server; }
    private sealed class State { internal int Failed; }
    private static void ReadLoop(Stream stream,bool server,BlockingCollection<Message> messages,State state)
    {
        try {
            while(true) {
                string value=OwnerWire.Read(stream,LifetimeMs);
                if(!messages.TryAdd(new Message{Value=value,Server=server},100)) {Interlocked.Exchange(ref state.Failed,1); return;}
            }
        } catch { }
        if(!messages.TryAdd(new Message{Value=null,Server=server},100)) Interlocked.Exchange(ref state.Failed,1);
    }
    internal static int Run(NamedPipeClientStream pipe,PeerIdentity.ServerLineage lineage)
    {
        Stream input=Console.OpenStandardInput(), output=Console.OpenStandardOutput();
        if(OwnerWire.Read(pipe,5000)!="H 1" || !lineage.IsLive()) return 2;
        OwnerWire.Write(output,"H 1",5000);
        var queue=new BlockingCollection<Message>(8); var state=new State();
        Thread sender=new Thread(delegate(){ReadLoop(input,false,queue,state);}); sender.IsBackground=true; sender.Start();
        Thread receiver=new Thread(delegate(){ReadLoop(pipe,true,queue,state);}); receiver.IsBackground=true; receiver.Start();
        Stopwatch lifetime=Stopwatch.StartNew(); string challenge=null,heartbeat=null,guard=null; long heartbeatSent=0,lastHeartbeat=0,guardSent=0; bool answered=false,approved=false,cancelling=false,shutdown=false,guardUsed=false;
        try {
            while(lifetime.ElapsedMilliseconds<LifetimeMs && lineage.IsLive()) {
                if(Interlocked.CompareExchange(ref state.Failed,0,0)!=0) throw new InvalidDataException();
                long now=lifetime.ElapsedMilliseconds;
                if(heartbeat!=null && now-heartbeatSent>=2000) throw new TimeoutException();
                if(guard!=null && now-guardSent>=3000) throw new TimeoutException();
                if(heartbeat==null && !cancelling && !shutdown && now-lastHeartbeat>=500) {
                    heartbeat=BitConverter.ToString(OwnerWire.Random(16)).Replace("-","").ToLowerInvariant();
                    OwnerWire.Write(output,"P "+heartbeat,1000); heartbeatSent=lifetime.ElapsedMilliseconds;
                }
                Message message; if(!queue.TryTake(out message,100)) continue;
                if(message.Value==null) throw new EndOfStreamException();
                string[] parts=message.Value.Split(' ');
                if(!message.Server) {
                    if(parts.Length==2 && parts[0]=="Q" && heartbeat!=null && parts[1]==heartbeat) { heartbeat=null; lastHeartbeat=lifetime.ElapsedMilliseconds; continue; }
                    if(parts.Length==2 && parts[0]=="G" && OwnerWire.IsChallenge(parts[1]) && approved && !guardUsed && !shutdown && !cancelling) {
                        guard=parts[1]; guardSent=lifetime.ElapsedMilliseconds; guardUsed=true; OwnerWire.Write(pipe,message.Value,1000); continue;
                    }
                    if(parts.Length==1 && parts[0]=="S" && !shutdown && !cancelling) { shutdown=true; OwnerWire.Write(pipe,"S",5000); continue; }
                    if(parts.Length==2 && parts[0]=="C" && challenge!=null && challenge==parts[1] && !shutdown && !cancelling) { cancelling=true; OwnerWire.Write(pipe,message.Value,5000); continue; }
                    if(parts.Length!=3 || parts[0]!="R" || challenge!=null || shutdown || cancelling || !OwnerWire.IsChallenge(parts[1]) || !OwnerWire.ValidPreview(parts[2])) throw new InvalidDataException();
                    challenge=parts[1]; OwnerWire.Write(pipe,message.Value,5000);
                } else {
                    if(parts.Length==1 && parts[0]=="L") { OwnerWire.Write(output,"L",1000); return 2; }
                    if(parts.Length==1 && parts[0]=="B" && shutdown) { OwnerWire.Write(output,"B",1000); return 0; }
                    if(parts.Length==2 && parts[0]=="Y" && guard!=null && parts[1]==guard && !shutdown && !cancelling && lifetime.ElapsedMilliseconds-guardSent<3000) {
                        OwnerWire.Write(output,message.Value,1000); guard=null; continue;
                    }
                    if(parts.Length!=2 || challenge==null || parts[1]!=challenge) throw new InvalidDataException();
                    if(parts[0]=="K" && cancelling) { OwnerWire.Write(output,message.Value,1000); return 0; }
                    if(parts[0]=="V") { OwnerWire.Write(output,message.Value,1000); return 2; }
                    if(parts[0]!="A" && parts[0]!="D" && parts[0]!="U") throw new InvalidDataException();
                    if(answered) throw new InvalidDataException(); answered=true;
                    approved=parts[0]=="A";
                    if(!cancelling && !shutdown) OwnerWire.Write(output,message.Value,1000);
                }
            }
        } catch { }
        try { OwnerWire.Write(output,"L",1000); } catch { }
        return 2;
    }
}
