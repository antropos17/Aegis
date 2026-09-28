using System;
using System.Net;
using System.Net.Sockets;

// Address codec only. No socket creation, host registration, bind or connection.
internal sealed class HvEndpoint : EndPoint
{
    private readonly Guid vm, service;
    internal HvEndpoint(Guid vmId, Guid serviceId)
    {
        BootstrapWire.Require(vmId != Guid.Empty && serviceId != Guid.Empty);
        foreach (string route in new string[] {
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "90db8b89-0d35-4f79-8ce9-49ea0ac8b7cd",
            "e0e16197-dd56-4a10-9195-5ee7a155a838",
            "a42e7cda-d03f-480c-9cc2-a4de20abb878"
        }) BootstrapWire.Require(vmId != new Guid(route));
        vm = vmId; service = serviceId;
    }
    public override AddressFamily AddressFamily { get { return (AddressFamily)34; } }
    public override SocketAddress Serialize()
    {
        var value = new SocketAddress(AddressFamily, 36);
        byte[] vmBytes = vm.ToByteArray(), serviceBytes = service.ToByteArray();
        for (int i = 0; i < 16; i++) { value[i + 4] = vmBytes[i]; value[i + 20] = serviceBytes[i]; }
        return value;
    }
    public override EndPoint Create(SocketAddress address)
    {
        BootstrapWire.Require(address.Family == AddressFamily && address.Size == 36 && address[2] == 0 && address[3] == 0);
        byte[] vmBytes = new byte[16], serviceBytes = new byte[16];
        for (int i = 0; i < 16; i++) { vmBytes[i] = address[i + 4]; serviceBytes[i] = address[i + 20]; }
        BootstrapWire.Require(new Guid(vmBytes) == vm && new Guid(serviceBytes) == service);
        return new HvEndpoint(vm, service);
    }
    internal static bool SelfTest()
    {
        Guid vmId = new Guid("11111111-2222-4333-8444-555555555555");
        Guid serviceId = new Guid("22222222-3333-4444-8555-666666666666");
        var endpoint = new HvEndpoint(vmId, serviceId);
        var address = endpoint.Serialize();
        endpoint.Create(address);
        byte[] bytes = new byte[36];
        for (int i = 0; i < bytes.Length; i++) bytes[i] = address[i];
        BootstrapWire.Require(BootstrapWire.Hex(bytes) == "22000000" +
            "11111111222233438444555555555555" + "22222222333344448555666666666666");
        address[4] ^= 1;
        try { endpoint.Create(address); return false; } catch (System.IO.InvalidDataException) { }
        address = endpoint.Serialize(); address[20] ^= 1;
        try { endpoint.Create(address); return false; } catch (System.IO.InvalidDataException) { }
        address = endpoint.Serialize(); address[2] = 1;
        try { endpoint.Create(address); return false; } catch (System.IO.InvalidDataException) { }
        try { endpoint.Create(new SocketAddress(AddressFamily.InterNetwork, 36)); return false; } catch (System.IO.InvalidDataException) { }
        try { endpoint.Create(new SocketAddress((AddressFamily)34, 35)); return false; } catch (System.IO.InvalidDataException) { }
        foreach (string route in new string[] {
            "00000000-0000-0000-0000-000000000000",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "90db8b89-0d35-4f79-8ce9-49ea0ac8b7cd",
            "e0e16197-dd56-4a10-9195-5ee7a155a838",
            "a42e7cda-d03f-480c-9cc2-a4de20abb878"
        }) try { new HvEndpoint(new Guid(route), serviceId); return false; } catch (System.IO.InvalidDataException) { }
        try { new HvEndpoint(vmId, Guid.Empty); return false; } catch (System.IO.InvalidDataException) { }
        return true;
    }
}
