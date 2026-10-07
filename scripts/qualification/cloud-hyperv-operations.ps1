Set-StrictMode -Version Latest

function Get-BoundedHyperVError([string]$Message) {
    $text = $Message -replace '[\r\n]', ' '
    return $text.Substring(0, [Math]::Min(512, $text.Length))
}

# No command accepts a caller-selected VM. The cloud entry point owns name/root/ID.
function Invoke-CloudHyperVCommand {
    param([string]$Action, [string]$Name, [string]$VmRoot, [string]$VmId)
    if ($Action -notin @('recover', 'create', 'configure', 'start', 'observe', 'stop', 'remove')) { throw 'Invalid operation' }
    if ($Name -notmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$') { throw 'Invalid owned name' }
    $seconds = if ($Action -eq 'start') { 45 } else { 30 }
    $job = Start-Job -ArgumentList $Action, $Name, $VmRoot, $VmId -ScriptBlock {
        param($Action, $Name, $VmRoot, $VmId)
        $ErrorActionPreference = 'Stop'
        Import-Module Hyper-V -ErrorAction Stop
        function FindOwned {
            # An exact successful CIM query distinguishes absent from cmdlet/provider errors.
            $filter = if ($VmId) { "Name='$VmId'" } else { "ElementName='$Name'" }
            $systems = @(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter $filter -OperationTimeoutSec 5)
            if ($systems.Count -eq 0) { return $null }
            if ($systems.Count -ne 1) { throw 'Ambiguous owned identity' }
            $found = @(Get-VM -Id ([guid]$systems[0].Name) -ErrorAction Stop)
            if ($found.Count -ne 1 -or $found[0].Name -cne $Name -or ($VmId -and $found[0].Id.ToString() -ne $VmId)) { throw 'VM ownership mismatch' }
            $location = [IO.Path]::GetFullPath($found[0].ConfigurationLocation).TrimEnd('\')
            $expected = [IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
            if ($location -ne $expected -and !$location.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'VM location mismatch' }
            $cursor = Get-Item -LiteralPath $location -Force
            while ($null -ne $cursor) {
                if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse location refused' }
                $cursor = $cursor.Parent
            }
            return $found[0]
        }
        function Snapshot($vm) {
            if ($null -eq $vm) { return @{ exists = $false } }
            return @{ exists = $true; vmId = $vm.Id.ToString(); name = $vm.Name; state = $vm.State.ToString(); generation = $vm.Generation;
                memoryStartup = $vm.MemoryStartup; dynamicMemory = $vm.DynamicMemoryEnabled; processors = $vm.ProcessorCount;
                disks = @(Get-VMHardDiskDrive -VM $vm).Count; nics = @(Get-VMNetworkAdapter -VM $vm).Count }
        }
        if ($Action -eq 'create') {
            if ($null -ne (FindOwned)) { throw 'Owned name already exists' }
            $vm = New-VM -Name $Name -Path $VmRoot -Generation 2 -MemoryStartupBytes 512MB -NoVHD
            if ($vm.Name -cne $Name -or $vm.Id -eq [guid]::Empty) { throw 'Created identity invalid' }
            # Return identity immediately; configuration is a separately observed operation.
            return @{ exists = $true; vmId = $vm.Id.ToString(); name = $vm.Name; state = $vm.State.ToString() }
        }
        $vm = FindOwned
        if ($Action -in @('recover', 'observe')) { return (Snapshot $vm) }
        if ($null -eq $vm -or !$VmId) { throw 'Exact owned VM unavailable' }
        switch ($Action) {
            'configure' {
                Set-VM -VM $vm -AutomaticCheckpointsEnabled $false -AutomaticStartAction Nothing -AutomaticStopAction TurnOff
                Set-VMMemory -VM $vm -DynamicMemoryEnabled $false -StartupBytes 512MB
                Set-VMProcessor -VM $vm -Count 1
                $adapters = @(Get-VMNetworkAdapter -VM $vm)
                foreach ($adapter in $adapters) { Remove-VMNetworkAdapter -VMNetworkAdapter $adapter -Confirm:$false }
            }
            'start' { Start-VM -VM $vm -Confirm:$false }
            'stop' { if ($vm.State.ToString() -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force -Confirm:$false } }
            'remove' {
                if ($vm.State.ToString() -ne 'Off') { throw 'Removal requires observed Off' }
                Remove-VM -VM $vm -Force -Confirm:$false
                return @{ removedCommandCompleted = $true; vmId = $VmId }
            }
        }
        return (Snapshot (FindOwned))
    }
    try {
        $finished = Wait-Job -Job $job -Timeout $seconds
        if ($null -eq $finished) { throw "operation-timeout:$Action" }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw "operation-failed:$Action" }
        return $values[0]
    }
    finally {
        # This only stops our command worker. Provider operations may still settle;
        # recovery/cleanup queries their exact owned identity rather than claiming cancellation.
        if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}

# Injectable fixed operation seam for local behavior checks, without Hyper-V effects.
function Invoke-OwnedHyperVSequence {
    param([scriptblock]$Command, [string]$Name, [string]$VmRoot)
    $receipt = [ordered]@{ vmId = $null; initialAbsenceObserved = $false; createAttempted = $false; created = $false; configured = $false; runningObserved = $false; offObserved = $false;
        removedObserved = $false; cleanupAttempted = $false; passed = $false; guestBoot = 'not-run-empty-firmware'; launchAllowed = $false;
        steps = [Collections.Generic.List[object]]::new(); failure = $null; cleanupFailure = $null; operationSettlement = 'settled-or-not-submitted' }
    function Step([string]$action) {
        $started = [DateTime]::UtcNow
        try {
            $value = & $Command $action $Name $VmRoot $receipt.vmId
            $receipt.steps.Add(@{ action = $action; success = $true; milliseconds = ([DateTime]::UtcNow - $started).TotalMilliseconds; observation = $value })
            return $value
        }
        catch {
            $text = Get-BoundedHyperVError $_.Exception.Message
            # A worker/transport failure can follow accepted service work. Neither
            # timeout nor a generic exception establishes terminal provider state.
            if ($action -in @('create', 'configure', 'start', 'stop', 'remove')) { $receipt.operationSettlement = 'unknown-provider-operation' }
            if ($text.Length -gt 512) { $text = $text.Substring(0, 512) }
            $receipt.steps.Add(@{ action = $action; success = $false; milliseconds = ([DateTime]::UtcNow - $started).TotalMilliseconds; error = $text; category = $_.CategoryInfo.Category.ToString() })
            throw
        }
    }
    function AcceptIdentity($value) {
        $parsed = [guid]::Empty
        if (!$value.exists -or $value.name -cne $Name -or ![guid]::TryParse($value.vmId, [ref]$parsed) -or $parsed -eq [guid]::Empty) { throw 'Invalid observed identity' }
        if ($receipt.vmId -and $value.vmId -ne $receipt.vmId) { throw 'Observed identity changed' }
        $receipt.vmId = $parsed.ToString()
    }
    try {
        $initial = Step 'recover'
        if ($initial.exists) { throw 'Owned name was not initially absent' }
        $receipt.initialAbsenceObserved = $true; $receipt.createAttempted = $true
        $created = Step 'create'; AcceptIdentity $created; $receipt.created = $true
        $configured = Step 'configure'; AcceptIdentity $configured
        if ($configured.generation -ne 2 -or $configured.memoryStartup -ne 512MB -or $configured.dynamicMemory -or $configured.processors -ne 1 -or $configured.disks -ne 0 -or $configured.nics -ne 0) { throw 'Configuration mismatch' }
        $receipt.configured = $true
        $null = Step 'start'
        $running = Step 'observe'; AcceptIdentity $running
        if ($running.state -ne 'Running') { throw 'Running not observed' }
        $receipt.runningObserved = $true
        $null = Step 'stop'
        $off = Step 'observe'; AcceptIdentity $off
        if ($off.state -ne 'Off') { throw 'Off not observed' }
        $receipt.offObserved = $true
    }
    catch { $receipt.failure = $receipt.steps[$receipt.steps.Count - 1].action + ':' + (Get-BoundedHyperVError $_.Exception.Message) }
    finally {
        $receipt.cleanupAttempted = $true
        try {
            if (!$receipt.createAttempted) { throw 'No created identity: cleanup mutation refused' }
            if ($receipt.operationSettlement -eq 'unknown-provider-operation') {
                # Worker cancellation does not prove service-job cancellation. A
                # late create/start can invalidate stop/removal; do not overwrite it.
                $current = Step 'recover'
                if ($current.exists) { AcceptIdentity $current }
                throw 'Provider operation unsettled; exact owned cleanup remains unknown'
            }
            if (!$receipt.vmId) {
                # Creation can time out after the service created the VM. Only the
                # previously absent unique name and owned config root may recover its ID.
                $recovered = Step 'recover'
                if ($recovered.exists) { AcceptIdentity $recovered }
                else { $receipt.removedObserved = $true }
            }
            if ($receipt.vmId) {
                $current = Step 'observe'
                if ($current.exists) {
                    AcceptIdentity $current
                    $null = Step 'stop'
                    $off = Step 'observe'; AcceptIdentity $off
                    if ($off.state -ne 'Off') { throw 'Cleanup Off not observed' }
                    $receipt.offObserved = $true
                    $null = Step 'remove'
                }
                $absent = Step 'observe'
                if ($absent.exists) { throw 'Removal not observed' }
                $receipt.removedObserved = $true
            }
        }
        catch { $receipt.cleanupFailure = Get-BoundedHyperVError $_.Exception.Message }
        $receipt.passed = $receipt.created -and $receipt.configured -and $receipt.runningObserved -and $receipt.offObserved -and $receipt.removedObserved -and !$receipt.failure -and !$receipt.cleanupFailure
    }
    return $receipt
}
