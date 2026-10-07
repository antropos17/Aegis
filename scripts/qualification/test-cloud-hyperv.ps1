Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
$name = 'aegis-cloud-1-1-11111111111111111111111111111111'
$id = '11111111-2222-3333-4444-555555555555'
function Require($value) { if (!$value) { throw 'Behavioral assertion failed' } }
foreach ($mode in @('positive', 'start-failure', 'late-timeout', 'late-create', 'create-transport', 'start-worker', 'preexisting', 'wrong-id', 'cleanup-failure')) {
    $state = @{ exists = $false; state = 'Off'; calls = [Collections.Generic.List[string]]::new() }
    $command = {
        param($action, $vmName, $root, $vmId)
        Require ($vmName -ceq $name -and $root -ceq 'synthetic-owned-root')
        $state.calls.Add($action)
        if ($mode -eq 'preexisting') { $state.exists = $true }
        if ($action -eq 'create') {
            if ($mode -eq 'late-create') { throw 'operation-timeout:create' }
            if ($mode -eq 'create-transport') { throw 'synthetic-transport-lost-after-submit' }
            $state.exists = $true
        }
        if ($action -eq 'recover' -and $mode -eq 'late-create' -and 'create' -in $state.calls) {
            $state.exists = $true # A provider create can settle after an absent query.
            return @{ exists = $false }
        }
        if ($action -eq 'start') {
            if ($mode -eq 'start-failure') { throw 'synthetic-start-failure' }
            if ($mode -eq 'start-worker') { $state.state = 'Running'; throw 'synthetic-worker-died-after-submit' }
            if ($mode -eq 'late-timeout') { $state.state = 'Running'; throw 'operation-timeout:start' }
            $state.state = 'Running'
        }
        if ($action -eq 'stop') { $state.state = 'Off' }
        if ($action -eq 'remove') {
            Require ($vmId -ceq $id -and $state.state -eq 'Off')
            if ($mode -eq 'cleanup-failure') { throw 'synthetic-remove-failure' }
            $state.exists = $false
        }
        if (!$state.exists) { return @{ exists = $false } }
        return @{ exists = $true; name = $name; vmId = if ($mode -eq 'wrong-id' -and $action -eq 'configure') { '99999999-2222-3333-4444-555555555555' } else { $id };
            state = $state.state; generation = 2; memoryStartup = 512MB; dynamicMemory = $false; processors = 1; disks = 0; nics = 0 }
    }
    $result = Invoke-OwnedHyperVSequence -Command $command -Name $name -VmRoot 'synthetic-owned-root'
    Require (!$result.launchAllowed -and $result.guestBoot -eq 'not-run-empty-firmware')
    if ($mode -eq 'positive') { Require ($result.passed -and $result.runningObserved -and $result.offObserved -and $result.removedObserved) }
    else { Require (!$result.passed -and ($result.failure -or $result.cleanupFailure)) }
    if ($mode -eq 'wrong-id') { Require ($result.removedObserved -and !$state.exists) }
    if ($mode -in @('start-failure', 'late-timeout', 'create-transport', 'start-worker')) { Require ($result.operationSettlement -eq 'unknown-provider-operation' -and $result.cleanupFailure -and !$result.removedObserved -and 'stop' -notin $state.calls -and 'remove' -notin $state.calls) }
    if ($mode -eq 'late-create') { Require ($result.operationSettlement -eq 'unknown-provider-operation' -and $result.cleanupFailure -and !$result.removedObserved -and $state.exists -and 'remove' -notin $state.calls) }
    if ($mode -eq 'preexisting') { Require ('create' -notin $state.calls -and 'remove' -notin $state.calls) }
    if ($mode -eq 'cleanup-failure') { Require ($result.cleanupFailure -and !$result.removedObserved) }
}
Require ((Get-BoundedHyperVError ("a`r`nb")) -eq 'a  b')
Require ((Get-BoundedHyperVError ('x' * 1000)).Length -eq 512)
Write-Output '9 synthetic lifecycle scenarios and bounded error checks passed; no Hyper-V calls executed.'
