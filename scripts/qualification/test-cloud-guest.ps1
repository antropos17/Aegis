Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$passed = 0
function Require([bool]$Value) { if (!$Value) { throw 'guest-behavior-control-failed' } }
function Refused([scriptblock]$Action) { try { & $Action | Out-Null; return $false } catch { return $true } }
$metadata = '<WIM><IMAGE INDEX="1"><NAME>Windows 11 Enterprise Evaluation</NAME><WINDOWS><EDITIONID>EnterpriseEval</EDITIONID><ARCH>9</ARCH><VERSION><MAJOR>10</MAJOR><MINOR>0</MINOR><BUILD>26300</BUILD><SPBUILD>9457</SPBUILD></VERSION></WINDOWS></IMAGE></WIM>'
$observed = Get-CloudGuestImageMetadata $metadata
Require ($observed.index -eq 1 -and $observed.version -eq '10.0.26300.9457'); $passed++
Require ((Get-CloudGuestImageMetadata ([char]0xfeff + $metadata)).index -eq 1); $passed++
foreach ($change in @(@('26300', '26100'), @('9457', '1742'), @('<ARCH>9', '<ARCH>12'), @('EnterpriseEval', 'Enterprise'), @('INDEX="1"', 'INDEX="0"'))) {
    $changed = $metadata.Replace($change[0], $change[1]); Require (Refused { Get-CloudGuestImageMetadata $changed }); $passed++
}
Require (Refused { Get-CloudGuestImageMetadata '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><WIM>&x;</WIM>' }); $passed++
Require (Refused { Get-CloudGuestImageMetadata ('x' * 524289) }); $passed++
$answer = New-CloudGuestAnswerText 1 'Aa1!synthetic-control&<123456789' 'Bb2!synthetic-control>123456789'
$xml = [xml]$answer; $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable); $ns.AddNamespace('u', 'urn:schemas-microsoft-com:unattend')
Require ($xml.SelectSingleNode('//u:DiskID', $ns).InnerText -eq '0' -and $xml.SelectSingleNode('//u:Value[../u:Key="/IMAGE/INDEX"]', $ns).InnerText -eq '1')
Require ($xml.SelectSingleNode('//u:LocalAccount[u:Name="AegisTask"]/u:Group', $ns).InnerText -eq 'Users')
Require ($xml.SelectSingleNode('//u:LocalAccount[u:Name="AegisSetup"]/u:Group', $ns).InnerText -eq 'Administrators')
Require ($answer -notmatch 'SkipMachineOOBE|LabConfig|BypassTPM|BypassSecureBoot|ProductKey'); $passed++
# Effectful entry refuses this local fixture without any ISO/VM creation.
$savedActions = $env:GITHUB_ACTIONS
try { $env:GITHUB_ACTIONS = $null; Require (Refused { Assert-CloudGuestRunner }); $passed++ }
finally { $env:GITHUB_ACTIONS = $savedActions }
# Execute the actual Stage helper: its label must not shadow the owned VM name.
$tokens = $null; $errors = $null
$driver = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-lab.ps1'), [ref]$tokens, [ref]$errors)
$stageDefinition = $driver.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stage' }, $true)
. ([scriptblock]::Create($stageDefinition.Extent.Text))
$report = @{ stages = [Collections.Generic.List[object]]::new(); failure = $null }
$name = 'aegis-cloud-123-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$observedName = Stage 'create-exact-owned-vm' { return $name }
Require ($observedName -ceq $name -and $report.stages[0].stage -ceq 'create-exact-owned-vm'); $passed++
$inner = [InvalidOperationException]::new('keyboard-owner-mismatch')
$wrapped = [Exception]::new('arbitrary wrapper text must stay private', $inner)
$details = Get-CloudGuestFailureDetails $wrapped
Require ($details.code -ceq 'keyboard-owner-mismatch' -and $details.innerDepth -eq 1 -and $details.hResult -eq $inner.HResult); $passed++
foreach ($text in @('lowercase-secret-shaped-string', 'private Credential Aa1!example', 'keyboard-owner-mismatch:secret')) {
    Require ((Get-CloudGuestFailureDetails ([Exception]::new($text))).code -ceq 'bounded-stage-failed'); $passed++
}
# Actual media helper with isolated provider doubles: each VM object captures a
# stale device snapshot, while Get-VM returns the current provider inventory.
$vmSource = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-vm.ps1'), [ref]$tokens, [ref]$errors)
$mediaDefinition = $vmSource.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Remove-CloudGuestInstallationMedia' }, $true)
. ([scriptblock]::Create($mediaDefinition.Extent.Text))
$savedGuard = ${function:Assert-CloudGuestRunner}.ToString()
$bootDefinition = $vmSource.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-CloudGuestBootWindow' }, $true)
. ([scriptblock]::Create($bootDefinition.Extent.Text))
function Start-Sleep { param($Milliseconds, $Seconds) }
try {
     foreach ($bootMode in @('keyboard-unavailable', 'vm-mismatch', 'thumbnail-mismatch', 'read-unavailable', 'success-until-stop',
         'owned-nonrunning', 'pending-nonrunning', 'foreign-nonrunning', 'malformed-nonrunning', 'thumbnail-nonrunning')) {
         $nativeDouble = [pscustomobject]@{ Mode = $bootMode; Calls = 0; Captures = 0; Closed = $false; PendingUnknown = $false; KeyboardObservation = @{ phase = 'query'; returnCode = 0; completed = $true } }
         $nativeDouble | Add-Member ScriptMethod SetupSpaceKey {
             $this.Calls++
             if ($this.Mode.EndsWith('-nonrunning') -and $this.Mode -ne 'thumbnail-nonrunning') {
                 $this.KeyboardObservation.phase = 'vm-owned-nonrunning'; $this.KeyboardObservation.vmIdentityMatched = $this.Mode -ne 'foreign-nonrunning'
                 $this.KeyboardObservation.enabledState = if ($this.Mode -eq 'malformed-nonrunning') { 32770 } else { [uint16]32770 }
                 $this.PendingUnknown = $this.Mode -eq 'pending-nonrunning'
                 throw 'keyboard-owned-vm-not-running'
             }
             if ($this.Mode -eq 'vm-mismatch') { $this.KeyboardObservation.phase = 'vm-observe'; throw 'keyboard-owned-vm-not-running' }
             if ($this.Mode -eq 'keyboard-unavailable' -or $this.Calls -eq 3) { throw 'exact-vm-keyboard-unavailable' }
             return $true
         }
         $nativeDouble | Add-Member ScriptMethod BootSnapshot {
             $this.Captures++
             if ($this.Mode -eq 'thumbnail-nonrunning') { return @{ failureCode = 'boot-owned-vm-not-running'; vmIdentityMatched = $true; enabledState = [uint16]32770; imageBase64 = $null } }
             if ($this.Mode -eq 'read-unavailable') { throw 'synthetic-private-error-must-not-cross-receipt' }
             return @{ failureCode = $(if ($this.Mode -eq 'thumbnail-mismatch') { 'boot-owned-vm-mismatch' } else { $null }); imageBase64 = $null }
         }
         $nativeDouble | Add-Member ScriptMethod CloseBootWindow { $this.Closed = $true }
         $window = Invoke-CloudGuestBootWindow $nativeDouble
         Require ($nativeDouble.Closed -and $window.closedBeforeCredentialSession -and $window.attempts -le 3 -and $window.snapshots.Count -le 2)
         Require ($window.outcomes.Count -eq $window.attempts)
         Require ($window.mandatoryFailure -eq ($bootMode -in @('vm-mismatch', 'thumbnail-mismatch', 'pending-nonrunning', 'foreign-nonrunning', 'malformed-nonrunning')))
         Require ($window.stoppedOnOwnedNonrunning -eq ($bootMode -in @('owned-nonrunning', 'thumbnail-nonrunning')))
         if ($bootMode.EndsWith('-nonrunning')) { Require ($nativeDouble.Calls -eq 1) }
         if ($bootMode -eq 'keyboard-unavailable') { Require ($nativeDouble.Captures -eq 0) }
         if ($bootMode -eq 'thumbnail-mismatch') { Require ($nativeDouble.Calls -eq 1) }
         if ($bootMode -eq 'read-unavailable') { Require ($window.snapshots[0].failureCode -ceq 'bounded-stage-failed' -and $window.completed -eq 2) }
         $passed++
     }
}
finally { Remove-Item Function:Start-Sleep }
function Assert-CloudGuestRunner { }
$fixtureId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; $fixtureRoot = Join-Path $env:TEMP 'media-owned-vm'; $fixtureName = $name
function Get-VM {
    param($Id, $ErrorAction)
    $script:mediaGets++
    if ($script:mediaMode -eq 'observe-error' -and $script:mediaGets -eq 3) { throw 'synthetic-read-error' }
    $selectedId = if ($script:mediaMode -eq 'wrong-id') { [guid]::Empty } else { $fixtureId }
    $selectedName = if ($script:mediaMode -eq 'wrong-name') { 'foreign' } else { $fixtureName }
    $selectedState = if ($script:mediaMode -eq 'off') { 'Off' } else { 'Running' }
    $selectedRoot = if ($script:mediaMode -eq 'wrong-root') { $fixtureRoot + '-foreign' } else { $fixtureRoot }
    return [pscustomobject]@{ Id = $selectedId; Name = $selectedName; State = $selectedState; ConfigurationLocation = $selectedRoot; CapturedDrives = @($script:mediaDrives) }
}
function Get-VMDvdDrive { param($VM, $ErrorAction); return $VM.CapturedDrives }
function Remove-VMDvdDrive {
    param($VMDvdDrive, $Confirm, $ErrorAction)
    $script:mediaRemoves++
    if ($script:mediaMode -eq 'mutation-error') { throw 'synthetic-worker-error' }
    if ($script:mediaMode -ne 'no-op') { $script:mediaDrives = @($script:mediaDrives | Where-Object { $_.ControllerLocation -ne $VMDvdDrive.ControllerLocation }) }
}
function Set-VMDvdDrive { param($VMDvdDrive, $Path); $script:mediaSets++; $script:mediaDrives = @() }
function ResetMedia([string]$Mode) {
    $script:mediaMode = $Mode; $script:mediaGets = 0; $script:mediaRemoves = 0; $script:mediaSets = 0
    $script:mediaDrives = @(1, 2 | ForEach-Object { [pscustomobject]@{ VMId = $fixtureId; ControllerNumber = 0; ControllerLocation = $_; Path = 'synthetic-private-answer.iso' } })
}
try {
    ResetMedia 'success'
    # Reproduce the original retained-object ejection check without Hyper-V.
    $retained = Get-VM -Id $fixtureId
    foreach ($dvd in @(Get-VMDvdDrive -VM $retained)) { Set-VMDvdDrive -VMDvdDrive $dvd -Path $null }
    Require (@(Get-VMDvdDrive -VM $retained | Where-Object Path).Count -eq 2 -and $script:mediaDrives.Count -eq 0); $passed++
    ResetMedia 'success'; $uncertain = $false
    $detached = Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain)
    Require ($detached.drivesBefore -eq 2 -and $detached.drivesAfter -eq 0 -and $detached.freshExactVmObserved -and !$uncertain -and $script:mediaGets -eq 3 -and $script:mediaRemoves -eq 2); $passed++
    foreach ($mode in @('wrong-id', 'wrong-name', 'wrong-root', 'off')) {
        ResetMedia $mode; $uncertain = $false
        Require (Refused { Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain) })
        Require ($script:mediaRemoves -eq 0 -and !$uncertain); $passed++
    }
    ResetMedia 'success'; $script:mediaDrives[0].VMId = [guid]::Empty; $uncertain = $false
    Require (Refused { Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain) }); Require ($script:mediaRemoves -eq 0 -and !$uncertain); $passed++
    ResetMedia 'mutation-error'; $uncertain = $false
    Require (Refused { Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain) }); Require ($uncertain -and $script:mediaRemoves -eq 1); $passed++
    ResetMedia 'observe-error'; $uncertain = $false
    Require (Refused { Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain) }); Require (!$uncertain -and $script:mediaRemoves -eq 2); $passed++
    ResetMedia 'no-op'; $uncertain = $false
    Require (Refused { Remove-CloudGuestInstallationMedia $fixtureId $fixtureName $fixtureRoot ([ref]$uncertain) }); Require (!$uncertain -and $script:mediaRemoves -eq 1); $passed++
    # The failure result crosses the same serialization boundary as Start-Job.
    $phase = @{ phase = 'detach-installation-media'; installedOs = @{ build = 26300; ubr = 9457; edition = 'EnterpriseEval' }; transferHashesVerified = $true }
    $roundtrip = [Management.Automation.PSSerializer]::Deserialize([Management.Automation.PSSerializer]::Serialize(@{ progress = $phase; failure = @{ code = 'answer-dvd-ejection-unconfirmed' }; mediaMutationUnknown = $false }))
    Require ($roundtrip.progress.installedOs.build -eq 26300 -and $roundtrip.progress.transferHashesVerified -and $roundtrip.mediaMutationUnknown -is [bool]); $passed++
    $guestStage = $driver.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Stage' -and $node.CommandElements[1].Extent.Text -eq "'actual-guest-setup-and-standard-task'" }, $true)
    $guestOperation = [scriptblock]::Create($guestStage.CommandElements[2].ScriptBlock.Extent.Text.Trim('{', '}'))
    $id = $fixtureId; $vmRoot = $fixtureRoot; $adminCredential = $null; $taskPassword = 'synthetic-unused'; $OutputRoot = $env:TEMP
    function Invoke-CloudGuestBootstrap {
        if ($script:bootstrapMode -eq 'lost') { throw 'guest-setup-or-task-deadline' }
        return @{ progress = $phase; failure = @{ code = 'answer-dvd-ejection-unconfirmed' }; mediaMutationUnknown = ($script:bootstrapMode -eq 'unknown') }
    }
    foreach ($mode in @('settled-failure', 'unknown', 'lost')) {
        $script:bootstrapMode = $mode; $script:unknown = $false
        $report = @{ stages = [Collections.Generic.List[object]]::new(); failure = $null; guest = $null; actualHead = ('a' * 40) }
        Require (Refused { Stage 'actual-guest-setup-and-standard-task' $guestOperation })
        Require ($script:unknown -eq ($mode -ne 'settled-failure'))
        if ($mode -ne 'lost') { Require ($report.guest.progress.installedOs.build -eq 26300 -and $report.guest.progress.transferHashesVerified) }
        $passed++
    }
}
finally {
    Set-Item Function:Assert-CloudGuestRunner ([scriptblock]::Create($savedGuard))
    foreach ($mock in @('Get-VM', 'Get-VMDvdDrive', 'Remove-VMDvdDrive', 'Set-VMDvdDrive', 'Invoke-CloudGuestBootstrap')) { Remove-Item ('Function:' + $mock) }
}
# Compile actual diagnostic/owner sources, but invoke only pure parsing/window
# methods. Never construct the owner or call WMI in these regression controls.
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Add-Type -Path @((Join-Path $PSScriptRoot 'CloudGuestBootDiagnostics.cs'), (Join-Path $PSScriptRoot 'CloudGuestVm.cs'),
    (Join-Path $projectRoot 'sidecar/session/OwnedVmLifecycle.cs'), (Join-Path $projectRoot 'sidecar/session/VmManagementNative.cs')) -ReferencedAssemblies System.Management
$diagnosticType = [CloudGuestVm].Assembly.GetType('CloudGuestBootDiagnostics')
$binding = [Reflection.BindingFlags]'Static,NonPublic'
$windowMethod = $diagnosticType.GetMethod('WindowAllowed', $binding)
foreach ($control in @(@($false, 0L, 0, 20000L, 2, $true), @($false, 19999L, 1, 20000L, 2, $true),
    @($false, 20000L, 0, 20000L, 2, $false), @($true, 0L, 0, 20000L, 2, $false), @($false, 1L, 2, 20000L, 2, $false),
    @($false, -1L, 0, 20000L, 2, $false), @($false, 60000L, 0, 60000L, 60, $false))) {
    Require ($windowMethod.Invoke($null, [object[]]$control[0..4]) -eq $control[5]); $passed++
}
$settingsMethod = $diagnosticType.GetMethod('SettingsIdentity', $binding)
foreach ($control in @(@('Microsoft:Hyper-V:System:Realized', $fixtureId, $true), @('Microsoft:Hyper-V:Snapshot:Realized', $fixtureId, $false),
    @('Microsoft:Hyper-V:System:Realized', '11111111-2222-3333-4444-555555555555', $false))) {
    Require ($settingsMethod.Invoke($null, [object[]]@($fixtureId, $control[0], $control[1])) -eq $control[2]); $passed++
}
$pixelsMethod = $diagnosticType.GetMethod('Pixels', $binding)
$syntheticPixels = New-Object byte[] 153600
# Explicit slots avoid PS5.1 boxing the byte array in PSObject for reflection.
$pixelArguments = New-Object object[] 2; $pixelArguments[0] = [uint32]0; $pixelArguments[1] = $syntheticPixels.PSObject.BaseObject
$encoded = $pixelsMethod.Invoke($null, $pixelArguments)
Require ($encoded.Length -eq 204800 -and [Convert]::FromBase64String($encoded).Length -eq 153600); $passed++
foreach ($control in @(@([uint32]4096, $syntheticPixels), @($null, $syntheticPixels), @([uint16]0, $syntheticPixels),
    @([uint32]0, $null), @([uint32]0, (New-Object byte[] 153599)), @([uint32]0, (New-Object byte[] 153601)))) {
    Require (Refused { $pixelsMethod.Invoke($null, [object[]]$control) }); $passed++
}
$budget = [Text.Encoding]::UTF8.GetByteCount((@{ snapshots = @(@{ imageBase64 = $encoded }, @{ imageBase64 = $encoded }) } | ConvertTo-Json -Depth 4))
Require ($budget -lt 512KB); $passed++
$observeMethod = $diagnosticType.GetMethod('ObserveVm', $binding)
foreach ($control in @(@('Msvm_ComputerSystem', $fixtureId, [uint16]2, $false), @('Msvm_ComputerSystem', $fixtureId, [uint16]32770, $false),
    @('Msvm_ComputerSystem', '11111111-2222-3333-4444-555555555555', [uint16]2, $true), @('ForeignClass', $fixtureId, [uint16]2, $true),
    @('Msvm_ComputerSystem', $fixtureId, $null, $true), @('Msvm_ComputerSystem', $fixtureId, [uint32]2, $true))) {
    $vmEvidence = [Collections.Generic.Dictionary[string,object]]::new()
    $arguments = New-Object object[] 5; $arguments[0] = $vmEvidence.PSObject.BaseObject; $arguments[1] = $fixtureId
    $arguments[2] = $control[0]; $arguments[3] = $control[1]; $arguments[4] = if ($null -eq $control[2]) { $null } else { $control[2].PSObject.BaseObject }
    $refused = Refused { $observeMethod.Invoke($null, $arguments) }
    Require ($refused -eq $control[3])
    if (!$refused) { Require ($vmEvidence.vmIdentityMatched -eq $true -and $vmEvidence.enabledState -eq $control[2] -and $vmEvidence.observedVmId -ceq $fixtureId) }
    $passed++
}
$imageMetadataMethod = $diagnosticType.GetMethod('ImageMetadata', $binding)
foreach ($control in @(@($null, 'null', $null), @([byte[]]::new(0), 'byte-array', 0), @([byte[]]::new(153599), 'byte-array', 153599),
    @([byte[]]::new(153600), 'byte-array', 153600), @([uint16[]]::new(3), 'other-array', 3), @('synthetic-private-value', 'other', $null))) {
    $imageEvidence = [Collections.Generic.Dictionary[string,object]]::new()
    $arguments = New-Object object[] 2; $arguments[0] = $imageEvidence.PSObject.BaseObject
    $arguments[1] = $null
    if ($null -ne $control[0]) { $arguments[1] = $control[0].PSObject.BaseObject }
    $imageMetadataMethod.Invoke($null, $arguments)
    Require ($imageEvidence.imageDataType -ceq $control[1] -and $imageEvidence.imageDataLength -eq $control[2] -and $imageEvidence.expectedImageBytes -eq 153600)
    Require (!$imageEvidence.ContainsKey('imageBase64')); $passed++
}
# Actual bounded PS5.1 native process controls; no media, guest or VM operation.
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$testRoot = Join-Path $temporary ('aegis-guest-wait-' + [guid]::NewGuid().ToString('N'))
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'native-test-reparse-parent-refused' }; $parent = $parent.Parent }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$outputs = @()
try {
    $sequence = 0
    foreach ($mode in @('zero', 'seven', 'zero', 'seven', 'zero', 'seven', 'head', 'node', 'delayed-zero', 'delayed-seven')) {
        $sequence++; $stdout = Join-Path $testRoot ($sequence.ToString() + '.txt'); $stderr = $stdout + '.error'; $outputs += @($stdout, $stderr)
        $executable = if ($mode -eq 'head') { 'git.exe' } elseif ($mode -eq 'node') { (Get-Command node.exe).Source } elseif ($mode.StartsWith('delayed')) { Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe' } else { Join-Path $env:WINDIR 'System32\cmd.exe' }
        $expectedExit = if ($mode.EndsWith('seven')) { 7 } else { 0 }
        $arguments = if ($mode -eq 'head') { @('-C', ('"' + [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')) + '"'), 'rev-parse', 'HEAD') } elseif ($mode -eq 'node') { @('--version') } elseif ($mode.StartsWith('delayed')) { @('-NoProfile', '-Command', ('"Start-Sleep -Milliseconds 80; exit ' + $expectedExit + '"')) } else { @('/d', '/c', ('exit ' + $expectedExit)) }
            $exitCode = Invoke-CloudGuestNativeProcess $executable $arguments $stdout $stderr 5000
            Require ($exitCode -eq $expectedExit)
            Require ((Get-Item -LiteralPath $stdout).Length -le 128 -and (Get-Item -LiteralPath $stderr).Length -eq 0)
            if ($mode -eq 'head') {
                $head = [IO.File]::ReadAllText($stdout).Trim(); Require ($head -cmatch '^[a-f0-9]{40}$')
                if ($env:EXPECTED_SOURCE_SHA) { Require ($head -ceq $env:EXPECTED_SOURCE_SHA) }
            }
            $passed++
    }
    foreach ($expectedExit in @(0, 7)) {
        $process = Start-CloudGuestNativeProcess (Join-Path $env:WINDIR 'System32\cmd.exe') @('/d', '/c', ('exit ' + $expectedExit))
        try {
            Require ($process.WaitForExit(5000) -and $process.HasExited)
            Require ((Wait-CloudGuestNativeProcess $process 1) -eq $expectedExit); $passed++
        }
        finally { $process.Dispose() }
    }
    foreach ($mode in @('stdout-budget', 'stderr-budget', 'deadline')) {
        $stdout = Join-Path $testRoot ($mode + '.txt'); $stderr = $stdout + '.error'; $outputs += @($stdout, $stderr)
        $body = if ($mode -eq 'deadline') { 'Start-Sleep -Seconds 5' } elseif ($mode -eq 'stdout-budget') { "[Console]::Out.Write(('x' * 70000))" } else { "[Console]::Error.Write(('y' * 70000))" }
        $expectedFailure = if ($mode -eq 'deadline') { 'native-process-deadline' } else { 'native-output-budget-failed' }
        $failure = $null
        try { Invoke-CloudGuestNativeProcess (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') @('-NoProfile', '-Command', ('"' + $body + '"')) $stdout $stderr $(if ($mode -eq 'deadline') { 1000 } else { 5000 }) | Out-Null }
        catch { $failure = Get-CloudGuestFailureDetails $_.Exception }
        Require ($null -ne $failure -and $failure.code -ceq $expectedFailure)
        Require ((Get-Item -LiteralPath $stdout).Length -le 65536 -and (Get-Item -LiteralPath $stderr).Length -le 65536); $passed++
    }
}
finally {
    foreach ($selected in $outputs) {
        if (Test-Path -LiteralPath $selected) {
            $file = Get-Item -LiteralPath $selected -Force
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.PSIsContainer -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'native-test-cleanup-scope-invalid' }
            Remove-Item -LiteralPath $selected -Force
        }
    }
    Remove-Item -LiteralPath $testRoot
}
foreach ($leaf in @('cloud-guest-media.ps1', 'cloud-guest-vm.ps1', 'cloud-guest-lab.ps1', 'cloud-guest-bootstrap.ps1')) {
    $tokens = $null; $errors = $null; [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $leaf), [ref]$tokens, [ref]$errors) | Out-Null
    Require ($errors.Count -eq 0)
}
@{ cases = $passed; passed = $passed; syntheticCases = 40; compiledPureCases = 30; nativeProcessCases = 15; syntaxFiles = 4; scope = 'media-answer-controls-and-bounded-native-waits-no-download-or-VM-effects' } | ConvertTo-Json -Compress

& (Join-Path $PSScriptRoot 'test-cloud-guest-diagnostics.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-invocation.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-token.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-token-cleanup.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-runtime.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-desktop.ps1')

& (Join-Path $PSScriptRoot 'test-host-routes.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-git-invocation.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-owner-probe.ps1')

& (Join-Path $PSScriptRoot 'test-cloud-guest-claude.ps1')
