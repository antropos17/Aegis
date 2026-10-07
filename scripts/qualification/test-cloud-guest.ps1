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
        $report = @{ stages = [Collections.Generic.List[object]]::new(); failure = $null; guest = $null }
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
# Actual bounded PS5.1 native process controls; no media, guest or VM operation.
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$testRoot = Join-Path $temporary ('aegis-guest-wait-' + [guid]::NewGuid().ToString('N'))
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'native-test-reparse-parent-refused' }; $parent = $parent.Parent }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$outputs = @()
try {
    foreach ($mode in @('zero', 'seven', 'head')) {
        $stdout = Join-Path $testRoot ($mode + '.txt'); $stderr = $stdout + '.error'; $outputs += @($stdout, $stderr)
        $executable = if ($mode -eq 'head') { 'git.exe' } else { Join-Path $env:WINDIR 'System32\cmd.exe' }
        $arguments = if ($mode -eq 'head') { @('-C', ('"' + [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')) + '"'), 'rev-parse', 'HEAD') } elseif ($mode -eq 'zero') { @('/d', '/c', 'exit 0') } else { @('/d', '/c', 'exit 7') }
        $process = Start-Process -FilePath $executable -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        try {
            $exitCode = Wait-CloudGuestNativeProcess $process 5000
            Require ($exitCode -eq $(if ($mode -eq 'seven') { 7 } else { 0 }))
            Require ((Get-Item -LiteralPath $stdout).Length -le 128 -and (Get-Item -LiteralPath $stderr).Length -eq 0)
            if ($mode -eq 'head') {
                $head = [IO.File]::ReadAllText($stdout).Trim(); Require ($head -cmatch '^[a-f0-9]{40}$')
                if ($env:EXPECTED_SOURCE_SHA) { Require ($head -ceq $env:EXPECTED_SOURCE_SHA) }
            }
            $passed++
        }
        finally { $process.Dispose() }
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
@{ cases = $passed; passed = $passed; syntheticCases = 30; nativeProcessCases = 3; syntaxFiles = 4; scope = 'media-answer-controls-and-bounded-native-waits-no-download-or-VM-effects' } | ConvertTo-Json -Compress
