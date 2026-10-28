using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Threading;

internal static class OwnerSession
{
    private const int LifetimeMs=15*60*1000;
    private sealed class Message { internal string Value; internal bool Worker; }
    private sealed class State { internal int Failed; }

    private static void ReadLoop(Stream stream,bool worker,BlockingCollection<Message> messages,State state)
    {
        try {
            while(true) {
                string value=OwnerWire.Read(stream,LifetimeMs);
                if(!messages.TryAdd(new Message { Value=value,Worker=worker },100)) { Interlocked.Exchange(ref state.Failed,1); return; }
            }
        } catch { }
        if(!messages.TryAdd(new Message { Value=null,Worker=worker },100)) Interlocked.Exchange(ref state.Failed,1);
    }

    internal static void Run(NamedPipeServerStream pipe,WorkerHost worker,NativeLaunch.Child electron,PeerIdentity.ProcessIdentity verifier,ProfileIsolation profile)
    {
        var messages=new BlockingCollection<Message>(8);
        var state=new State();
        Thread input=new Thread(delegate(){ReadLoop(pipe,false,messages,state);}); input.IsBackground=true; input.Start();
        Thread control=new Thread(delegate(){ReadLoop(worker.Output,true,messages,state);}); control.IsBackground=true; control.Start();
        Stopwatch lifetime=Stopwatch.StartNew(); string challenge=null,probe=null,guard=null; long probeStarted=0,lastProbe=0,guardStarted=0; bool answered=false,approved=false,probeForGuard=false,guardUsed=false;
        OwnerWire.Write(pipe,"H 1",5000);
        while(lifetime.ElapsedMilliseconds<LifetimeMs && !electron.Exited && verifier.IsLive()) {
            if(Interlocked.CompareExchange(ref state.Failed,0,0)!=0) throw new InvalidDataException();
            long now=lifetime.ElapsedMilliseconds;
            if(probe!=null && now-probeStarted>=1500) throw new TimeoutException();
            if(guard!=null && now-guardStarted>=3000) throw new TimeoutException();
            if(probe==null && (guard!=null || now-lastProbe>=500)) {
                probe=BitConverter.ToString(OwnerWire.Random(16)).Replace("-","").ToLowerInvariant(); probeForGuard=guard!=null;
                OwnerWire.Write(worker.Input,"T "+probe,1000); probeStarted=lifetime.ElapsedMilliseconds;
            }
            Message message;
            if(!messages.TryTake(out message,100)) { if(worker.Process.Exited) { OwnerWire.Write(pipe,challenge==null?"L":"V "+challenge,1000); return; } continue; }
            if(message.Value==null) { try { OwnerWire.Write(pipe,challenge==null?"L":"V "+challenge,1000); } catch {} return; }
            string[] parts=message.Value.Split(' ');
            if(message.Worker) {
                if(parts.Length==2 && parts[0]=="Z") {
                    if(probe==null || parts[1]!=probe || lifetime.ElapsedMilliseconds-probeStarted>=1500 || worker.Process.Exited || !verifier.IsLive()) throw new InvalidDataException();
                    probe=null; lastProbe=lifetime.ElapsedMilliseconds;
                    if(probeForGuard) {
                        if(guard==null || lifetime.ElapsedMilliseconds-guardStarted>=3000) throw new InvalidDataException();
                        if(profile!=null)profile.Validate();
                        OwnerWire.Write(pipe,"Y "+guard,1000); guard=null;
                    }
                    continue;
                }
                if(parts.Length==1 && parts[0]=="L") { OwnerWire.Write(pipe,"L",1000); return; }
                if(parts.Length!=2 || challenge==null || parts[1]!=challenge || (parts[0]!="A" && parts[0]!="D" && parts[0]!="U" && parts[0]!="V")) throw new InvalidDataException();
                if(parts[0]=="V") { OwnerWire.Write(pipe,message.Value,1000); return; }
                if(answered) throw new InvalidDataException(); answered=true;
                approved=parts[0]=="A";
                OwnerWire.Write(pipe,message.Value,1000);
                if(parts[0]!="A") return;
            } else {
                if(parts.Length==2 && parts[0]=="G" && OwnerWire.IsChallenge(parts[1]) && approved && !guardUsed && guard==null) {
                    if(profile!=null)profile.Validate();
                    guard=parts[1]; guardUsed=true; guardStarted=lifetime.ElapsedMilliseconds; continue;
                }
                if(parts.Length==1 && parts[0]=="S") {
                    if(!worker.Stop()) throw new InvalidOperationException("worker termination uncertain");
                    OwnerWire.Write(pipe,"B",1000); return;
                }
                if(parts.Length==2 && parts[0]=="C" && challenge!=null && parts[1]==challenge) {
                    if(!worker.Stop()) throw new InvalidOperationException("worker termination uncertain");
                    OwnerWire.Write(pipe,"K "+challenge,1000); return;
                }
                if(parts.Length!=3 || parts[0]!="R" || challenge!=null || !OwnerWire.IsChallenge(parts[1]) || !OwnerWire.ValidPreview(parts[2])) throw new InvalidDataException();
                if(profile!=null)profile.Validate();
                challenge=parts[1]; OwnerWire.Write(worker.Input,message.Value,5000);
            }
        }
        try { OwnerWire.Write(pipe,challenge==null?"L":"V "+challenge,1000); } catch { }
    }
}
