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
@{ cases = $passed; passed = $passed; syntheticCases = 11; nativeProcessCases = 3; syntaxFiles = 4; scope = 'media-answer-controls-and-bounded-native-waits-no-download-or-VM-effects' } | ConvertTo-Json -Compress
