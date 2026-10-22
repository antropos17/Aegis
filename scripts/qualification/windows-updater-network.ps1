# Ephemeral hosted-runner network only. Existing NATs and switches are never changed.
function Invoke-UpdaterNetwork([ValidateSet('connect','remove')][string]$Action,[string]$VmId,[string]$Name,[string]$VmRoot) {
  Assert-CloudGuestRunner
  if($Name -notmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$' -or $VmId -notmatch '^[a-f0-9-]{36}$') { throw 'Owned network identity required' }
  $job=Start-Job -ArgumentList $Action,$VmId,$Name,$VmRoot -ScriptBlock {
    param($Action,$VmId,$Name,$VmRoot)
    $ErrorActionPreference='Stop'
    Import-Module Hyper-V
    $prefix='192.168.241.0/24';$gateway='192.168.241.1'
    if($Action -eq 'connect') {
      if(@(Get-NetNat).Count -or @(Get-VMSwitch | Where-Object Name -eq $Name).Count -or @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '192.168.241.*').Count) { throw 'Existing/conflicting network refused' }
      $vm=Get-VM -Id ([guid]$VmId)
      $location=[IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\');$root=[IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
      if($vm.Name -cne $Name -or ($location -ne $root -and -not $location.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -or @(Get-VMNetworkAdapter -VM $vm).Count) { throw 'Owned offline VM required' }
      $dns=@(Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object ServerAddresses | Where-Object { $_ -and $_ -ne '127.0.0.1' } | Select-Object -Unique)
      if($dns.Count -eq 0 -or $dns.Count -gt 8) { throw 'Host DNS unavailable' }
      $switch=New-VMSwitch -Name $Name -SwitchType Internal
      $nic=Get-NetAdapter -Name ('vEthernet ('+$Name+')')
      New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $gateway -PrefixLength 24 | Out-Null
      New-NetNat -Name $Name -InternalIPInterfaceAddressPrefix $prefix | Out-Null
      Add-VMNetworkAdapter -VM $vm -Name UpdaterTransport -SwitchName $Name
      $attached=@(Get-VMNetworkAdapter -VM $vm)
      if($attached.Count -ne 1 -or $attached[0].SwitchId -ne $switch.Id -or @(Get-NetNatStaticMapping -NatName $Name).Count) { throw 'Unexpected update network layout' }
      return @{status='PASS';switchId=$switch.Id.ToString();name=$Name;prefix=$prefix;gateway=$gateway;dns=$dns;guestNics=1;inboundMappings=0;transport='WinNAT outbound; no proxy, feed override or TLS interception';firewallUnchanged=$true}
    }
    if(@(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "Name='$VmId'" -OperationTimeoutSec 5).Count) { throw 'Remove the owned VM before its network' }
    $nat=@(Get-NetNat | Where-Object Name -ceq $Name)
    if($nat.Count -gt 1 -or ($nat.Count -eq 1 -and $nat[0].InternalIPInterfaceAddressPrefix -ne $prefix)) { throw 'NAT ownership mismatch' }
    if($nat.Count) { $nat | Remove-NetNat -Confirm:$false }
    $switch=@(Get-VMSwitch | Where-Object Name -ceq $Name)
    if($switch.Count -gt 1 -or ($switch.Count -eq 1 -and $switch[0].SwitchType -ne 'Internal')) { throw 'Switch ownership mismatch' }
    if($switch.Count) {
      if(@(Get-VM | Get-VMNetworkAdapter | Where-Object SwitchId -eq $switch[0].Id).Count) { throw 'Switch still has attached VM' }
      $nic=Get-NetAdapter -Name ('vEthernet ('+$Name+')')
      Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 | Where-Object IPAddress -eq $gateway | Remove-NetIPAddress -Confirm:$false
      $switch | Remove-VMSwitch -Force
    }
    if(@(Get-NetNat | Where-Object Name -ceq $Name).Count -or @(Get-VMSwitch | Where-Object Name -ceq $Name).Count) { throw 'Network removal unconfirmed' }
    return @{status='PASS';natRemoved=$true;switchRemoved=$true;name=$Name}
  }
  try {
    if(-not (Wait-Job -Job $job -Timeout 60)) { throw 'Owned network operation deadline exceeded' }
    $values=@(Receive-Job -Job $job -ErrorAction Stop)
    if($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'Owned network operation failed' }
    return $values[0]
  } finally {
    if($job.State -in @('Running','NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
}
