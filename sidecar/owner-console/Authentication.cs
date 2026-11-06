using System;
using System.IO;

internal static class OwnerAuthentication
{
    private const int TimeoutMs = 5000;
    private static byte[] Decode(string value)
    {
        byte[] data=Convert.FromBase64String(value);
        if(data.Length!=32 || Convert.ToBase64String(data)!=value) throw new InvalidDataException();
        return data;
    }
    internal static void Server(Stream pipe,byte[] secret)
    {
        byte[] server=OwnerWire.Random(32);
        OwnerWire.Write(pipe,"N "+Convert.ToBase64String(server),TimeoutMs);
        string[] proof=OwnerWire.Read(pipe,TimeoutMs).Split(' ');
        if(proof.Length!=3 || proof[0]!="P") throw new InvalidDataException();
        byte[] client=Decode(proof[1]); byte[] supplied=Decode(proof[2]);
        if(!OwnerWire.Equal(supplied,OwnerWire.Mac(secret,"client",server,client))) throw new InvalidDataException();
        OwnerWire.Write(pipe,"M "+Convert.ToBase64String(OwnerWire.Mac(secret,"server",server,client)),TimeoutMs);
    }
    internal static void Client(Stream pipe,byte[] secret)
    {
        string[] initial=OwnerWire.Read(pipe,TimeoutMs).Split(' ');
        if(initial.Length!=2 || initial[0]!="N") throw new InvalidDataException();
        byte[] server=Decode(initial[1]); byte[] client=OwnerWire.Random(32);
        OwnerWire.Write(pipe,"P "+Convert.ToBase64String(client)+" "+Convert.ToBase64String(OwnerWire.Mac(secret,"client",server,client)),TimeoutMs);
        string[] response=OwnerWire.Read(pipe,TimeoutMs).Split(' ');
        if(response.Length!=2 || response[0]!="M" || !OwnerWire.Equal(Decode(response[1]),OwnerWire.Mac(secret,"server",server,client))) throw new InvalidDataException();
    }
}
