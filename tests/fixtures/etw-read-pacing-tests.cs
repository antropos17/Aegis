using System;

// Managed-only clock replay. The simulated delays are regression inputs, not VM measurements.
internal static class ManagedPacingTests
{
    private sealed class Clock
    {
        internal long Milliseconds;
        internal int PauseCalls;
        internal Func<int,int> Advance=milliseconds=>milliseconds;

        internal long Elapsed() { return Milliseconds; }
        internal void Pause(int milliseconds)
        {
            Check(milliseconds>0,"positive-pause");
            int advance=Advance(milliseconds);
            Check(advance>0,"advancing-clock");
            PauseCalls++;
            Check(PauseCalls<10000,"bounded-pause-count");
            Milliseconds+=advance;
        }
    }

    private static void Check(bool condition,string code)
    {
        if(!condition)throw new Exception(code);
    }

    private static int Replay(Clock clock,Func<int,int> readWork)
    {
        int completedReads=0;
        for(int index=0;index<160;index++)
        {
            clock.Milliseconds+=readWork(index);
            completedReads++;
            EtwReadProcess.PaceRead(completedReads,clock.Elapsed,clock.Pause);
        }
        return completedReads;
    }

    private static void Report(string mode,Clock clock,int reads)
    {
        Console.WriteLine("{\"case\":\""+mode+"\",\"modeledReads\":"+reads+
            ",\"elapsedMilliseconds\":"+clock.Milliseconds+",\"pauseCalls\":"+clock.PauseCalls+"}");
    }

    private static void Run(string mode)
    {
        var clock=new Clock();
        int reads;
        switch(mode)
        {
            case "regular":
                reads=Replay(clock,index=>5);
                Report(mode,clock,reads);
                Check(reads==160 && clock.Milliseconds==3200 && clock.PauseCalls==160,"nominal-observation-window");
                break;
            case "rounded-budget":
                clock.Advance=milliseconds=>((milliseconds+99)/100)*100;
                reads=Replay(clock,index=>10);
                Report(mode,clock,reads);
                Check(reads==160,"completed-read-count");
                Check(clock.Milliseconds<12000,"command-budget-with-rounded-wakes");
                Check(clock.Milliseconds>=3200 && clock.Milliseconds<3300,"rounded-wake-observation-window");
                break;
            case "io-budget":
                reads=Replay(clock,index=>25);
                Report(mode,clock,reads);
                Check(reads==160 && clock.Milliseconds==4000 && clock.PauseCalls==0,"io-already-consumes-cadence");
                break;
            case "early-wake":
                clock.Advance=milliseconds=>(milliseconds+1)/2;
                reads=Replay(clock,index=>0);
                Report(mode,clock,reads);
                Check(reads==160 && clock.Milliseconds==3200 && clock.PauseCalls>160,"early-wake-rechecks-clock");
                break;
            case "already-late":
                clock.Milliseconds=5000;
                EtwReadProcess.PaceRead(1,clock.Elapsed,clock.Pause);
                EtwReadProcess.PaceRead(160,clock.Elapsed,clock.Pause);
                Report(mode,clock,0);
                Check(clock.Milliseconds==5000 && clock.PauseCalls==0,"late-work-needs-no-extra-pause");
                break;
            case "mid-read-stall":
                reads=Replay(clock,index=>index==63?1005:5);
                Report(mode,clock,reads);
                Check(reads==160 && clock.Milliseconds==3200 && clock.PauseCalls<160,"in-loop-stall-consumes-cadence");
                break;
            default:
                throw new Exception("fixture-mode");
        }
    }

    public static int Main(string[] args)
    {
        try
        {
            Check(args.Length==1,"fixture-mode");
            Run(args[0]);
            return 0;
        }
        catch(Exception error)
        {
            Console.Error.WriteLine("FAIL:"+error.Message);
            return 1;
        }
    }
}
