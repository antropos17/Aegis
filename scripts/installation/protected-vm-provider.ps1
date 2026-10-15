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
        $env:PSModulePath = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\Modules'
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
        function AddStorage($Settings, $Service, [string]$Subtype, [string]$Parent, [string]$Address, [string]$HostPath) {
            # Keep resource identities and returned jobs under the transaction.
            # The coordinator holds media and seals VMMS directory ACL updates.
            $pools = @(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_ResourcePool -Filter "ResourceSubType='$Subtype' AND Primordial=True")
            if ($pools.Count -ne 1) { throw 'protected-vm-resource-pool-refused' }
            $capabilities = @($pools[0].GetRelated('Msvm_AllocationCapabilities'))
            if ($capabilities.Count -ne 1) { throw 'protected-vm-resource-capability-refused' }
            $defaults = @($capabilities[0].GetRelationships('Msvm_SettingsDefineCapabilities') | Where-Object { $_.ValueRole -eq 0 -and $_.ValueRange -eq 0 })
            if ($defaults.Count -ne 1) { throw 'protected-vm-resource-default-refused' }
            $definition = [wmi]$defaults[0].PartComponent
            if ($definition.ResourceSubType -cne $Subtype) { throw 'protected-vm-resource-definition-refused' }
            $resource = $definition.PSBase.Clone()
            $resource['Parent'] = $Parent
            if ($HostPath) { $resource['HostResource'] = [string[]]@($HostPath) } else { $resource['AddressOnParent'] = $Address }
            $inputParameters = $Service.PSBase.GetMethodParameters('AddResourceSettings')
            $inputParameters['AffectedConfiguration'] = $Settings.__PATH
            $inputParameters['ResourceSettings'] = [string[]]@($resource.GetText([Management.TextFormat]::CimDtd20))
            $options = [Management.InvokeMethodOptions]::new(); $options.Timeout = [TimeSpan]::FromSeconds(3)
            $outputParameters = $Service.PSBase.InvokeMethod('AddResourceSettings', $inputParameters, $options)
            $code = [uint32]$outputParameters['ReturnValue']
            if ($code -eq 4096) {
                $path = [Management.ManagementPath]::new([string]$outputParameters['Job'])
                if (!$path.IsInstance -or $path.ClassName -ine 'Msvm_ConcreteJob' -or $path.NamespacePath -ine 'root\virtualization\v2' -or
                    ($path.Server -cne '.' -and ![string]::Equals($path.Server, [Environment]::MachineName, [StringComparison]::OrdinalIgnoreCase))) { throw 'protected-vm-resource-job-refused' }
                $watch = [Diagnostics.Stopwatch]::StartNew()
                while ($true) {
                    $jobObject = [wmi]$path.Path
                    if ($jobObject.JobState -eq 7 -and $jobObject.ErrorCode -eq 0) { break }
                    if ($jobObject.JobState -notin @(2, 3, 4, 5, 6, 11) -or $watch.ElapsedMilliseconds -ge 30000) { throw 'protected-vm-resource-settlement-unknown' }
                    Start-Sleep -Milliseconds 50
                }
            } elseif ($code -ne 0) { throw 'protected-vm-resource-add-refused' }
            $paths = @($outputParameters['ResultingResourceSettings'])
            if ($paths.Count -ne 1 -or $paths[0] -isnot [string]) { throw 'protected-vm-resource-result-refused' }
            return $paths[0]
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
            $systems = @(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_ComputerSystem -Filter "Name='$Id'")
            if ($systems.Count -ne 1 -or $systems[0].EnabledState -ne 3) { throw 'protected-vm-resource-owner-refused' }
            $settings = @($systems[0].GetRelated('Msvm_VirtualSystemSettingData') | Where-Object { $_.VirtualSystemType -ceq 'Microsoft:Hyper-V:System:Realized' -and [guid]$_.VirtualSystemIdentifier -eq [guid]$Id })
            if ($settings.Count -ne 1) { throw 'protected-vm-resource-owner-refused' }
            $controllers = @($settings[0].GetRelated('Msvm_ResourceAllocationSettingData') | Where-Object ResourceSubType -CEQ 'Microsoft:Hyper-V:Synthetic SCSI Controller')
            $services = @(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_VirtualSystemManagementService)
            if ($controllers.Count -ne 1 -or $services.Count -ne 1) { throw 'protected-vm-resource-controller-refused' }
            $drivePath = AddStorage $settings[0] $services[0] 'Microsoft:Hyper-V:Synthetic Disk Drive' $controllers[0].__PATH '0' ''
            AddStorage $settings[0] $services[0] 'Microsoft:Hyper-V:Virtual Hard Disk' $drivePath '' $disk | Out-Null
            $dvdPath = AddStorage $settings[0] $services[0] 'Microsoft:Hyper-V:Synthetic DVD Drive' $controllers[0].__PATH '1' ''
            AddStorage $settings[0] $services[0] 'Microsoft:Hyper-V:Virtual CD/DVD Disk' $dvdPath '' $image | Out-Null
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
