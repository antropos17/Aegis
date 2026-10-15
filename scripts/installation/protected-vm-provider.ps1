Set-StrictMode -Version Latest

# Only the elevated installer calls this adapter. A timed-out worker is not a
# cancelled VMMS operation; its caller must retain the pending ownership journal.
function Invoke-ProtectedVmProvider($Owned, [ValidateSet('create', 'configure', 'observe', 'remove')][string]$Action) {
    Assert-ProtectedInstallAdministrator
    $job = Start-Job -ArgumentList $Action, $Owned.name, $Owned.root.PathName, $Owned.vmId -ScriptBlock {
        param($Action, $Name, $Root, $Id)
        Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
        $checkpoint = 1
        try {
        Import-Module Hyper-V -ErrorAction Stop
        $machine = Join-Path $Root 'Machine'; $disk = Join-Path $Root 'Disks\system.vhdx'; $image = Join-Path $Root 'Images\boot.iso'
        function FindExact {
            if (!$Id) { throw 'protected-vm-identity-required' }
            $rows = @(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "Name='$Id'" -OperationTimeoutSec 5)
            if ($rows.Count -eq 0) { return $null }
            if ($rows.Count -ne 1) { throw 'protected-vm-identity-refused' }
            $vms = @(Get-VM -Id ([guid]$Id) -ErrorAction Stop)
            if ($vms.Count -ne 1 -or $vms[0].Id.ToString('D') -cne $Id -or $vms[0].Name -cne $Name) { throw 'protected-vm-identity-refused' }
            $location = [IO.Path]::GetFullPath($vms[0].ConfigurationLocation).TrimEnd('\')
            if ($location -cne $machine -and !$location.StartsWith($machine + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'protected-vm-identity-refused' }
            return $vms[0]
        }
        function Observe($Vm) {
            if ($null -eq $Vm) { return @{ absent = $true } }
            if ($Vm.State.ToString() -cne 'Off') { throw 'protected-vm-off-required' }
            return @{ vmId = $Vm.Id.ToString('D'); name = $Vm.Name; off = $true }
        }
        if ($Action -ceq 'create') {
            $checkpoint = 2
            if (@(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$Name'" -OperationTimeoutSec 5).Count -ne 0 -or (Test-Path -LiteralPath $machine)) { throw 'protected-vm-fresh-required' }
            $checkpoint = 3
            $vm = New-VM -Name $Name -Path $machine -Generation 2 -MemoryStartupBytes 4GB -NoVHD
            $checkpoint = 4
            if ($vm.Name -cne $Name -or $vm.Id -eq [guid]::Empty) { throw 'protected-vm-create-result-refused' }
            # This returned identity is the sole source of mutation ownership.
            return (Observe $vm)
        }
        $vm = FindExact
        $checkpoint = 5
        if ($Action -ceq 'observe') { return (Observe $vm) }
        if ($null -eq $vm) { throw 'protected-vm-owned-instance-absent' }
        Observe $vm | Out-Null
        if ($Action -ceq 'configure') {
            $checkpoint = 7
            Set-VM -VM $vm -AutomaticStartAction Nothing -AutomaticStopAction TurnOff -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
            Set-VMMemory -VM $vm -DynamicMemoryEnabled $false -StartupBytes 4GB
            Set-VMProcessor -VM $vm -Count 2
            Get-VMNetworkAdapter -VM $vm | Remove-VMNetworkAdapter
            Add-VMHardDiskDrive -VM $vm -Path $disk -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 0
            Add-VMDvdDrive -VM $vm -Path $image -ControllerNumber 0 -ControllerLocation 1
            $dvd = @(Get-VMDvdDrive -VM $vm)
            Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice $dvd[0]
            $vm = FindExact; $disks = @(Get-VMHardDiskDrive -VM $vm); $dvd = @(Get-VMDvdDrive -VM $vm)
            if ($vm.Generation -ne 2 -or $vm.DynamicMemoryEnabled -or $vm.MemoryStartup -ne 4GB -or $vm.ProcessorCount -ne 2 -or
                $vm.AutomaticStartAction.ToString() -cne 'Nothing' -or $vm.AutomaticStopAction.ToString() -cne 'TurnOff' -or
                $vm.AutomaticCheckpointsEnabled -or $vm.CheckpointType.ToString() -cne 'Disabled' -or
                @(Get-VMNetworkAdapter -VM $vm).Count -ne 0 -or $disks.Count -ne 1 -or $disks[0].Path -cne $disk -or
                $dvd.Count -ne 1 -or $dvd[0].Path -cne $image -or (Get-VMFirmware -VM $vm).SecureBoot.ToString() -cne 'On') { throw 'protected-vm-configuration-refused' }
        }
        if ($Action -ceq 'remove') {
            $checkpoint = 8
            Remove-VM -VM $vm -Force
            if ($null -ne (FindExact)) { throw 'protected-vm-removal-unconfirmed' }
            return @{ absent = $true }
        }
        return (Observe (FindExact))
        } catch {
            $codes = @([regex]::Matches($_.Exception.ToString(), '0x[0-9a-fA-F]{8}') | Select-Object -First 8 | ForEach-Object { $_.Value.ToLowerInvariant() })
            return @{ providerFailure = $true; checkpoint = [int]$checkpoint; category = [int]$_.CategoryInfo.Category;
                hResult = [int]$_.Exception.HResult; line = [int]$_.InvocationInfo.ScriptLineNumber; codes = $codes }
        }
    }
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 60)) { throw 'protected-vm-provider-settlement-unknown' }
        $rows = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -cne 'Completed' -or $rows.Count -ne 1) { throw 'protected-vm-provider-result-unknown' }
        if ($rows[0].ContainsKey('providerFailure')) {
            $failure = [InvalidOperationException]::new('protected-vm-provider-result-unknown')
            foreach ($key in @('checkpoint', 'category', 'hResult', 'line')) { $failure.Data['vmProvider-' + $key] = [int]$rows[0][$key] }
            $failure.Data['vmProvider-codes'] = [string[]]@($rows[0].codes)
            throw $failure
        }
        return $rows[0]
    } finally {
        if ($job.State -eq 'Running') { Stop-Job -Job $job }
        Remove-Job -Job $job -Force
    }
}
