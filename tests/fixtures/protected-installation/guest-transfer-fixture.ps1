param([string]$Project, [string]$Root)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$path = Join-Path $Project 'scripts/qualification/installed-owner-guest-phase.ps1'
. ([scriptblock]::Create([IO.File]::ReadAllText($path)))
$payload = Join-Path $Root 'installed-owner'
New-Item -ItemType Directory -Path $payload | Out-Null
$pins = @(foreach ($leaf in Get-InstalledOwnerGuestPayloadLeaves) {
    $file = Join-Path $payload $leaf
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
    [IO.File]::WriteAllBytes($file, [byte[]]@(65))
    @{ relative = $leaf; bytes = 1; sha256 = ('a' * 64) }
})
$pinsJson = $pins | ConvertTo-Json -Depth 3 -Compress
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
$start = $ast.Find({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Start-Job'
}, $true)
$child = @($start.CommandElements | Where-Object { $_ -is [Management.Automation.Language.ScriptBlockExpressionAst] })
if ($errors.Count -or $child.Count -ne 1) { throw 'transfer-fixture-source-refused' }
$initialization = {
    $script:copied = @()
    function New-PSSession { param($VMId, $Credential, $ErrorAction) return 'fixture-session' }
    function Remove-PSSession { param($Session, $ErrorAction) }
    function Copy-Item {
        param([string]$LiteralPath, $ToSession, [string]$Destination)
        if ($ToSession -cne 'fixture-session' -or [IO.File]::ReadAllBytes($LiteralPath).Length -ne 1 -or
            !$Destination.StartsWith('C:\ProgramData\AegisCloudLab\installed-owner-inputs\', [StringComparison]::Ordinal)) {
            throw 'transfer-fixture-copy-refused'
        }
        $script:copied += $Destination.Substring('C:\ProgramData\AegisCloudLab\installed-owner-inputs\'.Length).Replace('\', '/')
    }
    function Invoke-Command {
        param($Session, $ScriptBlock, $ArgumentList)
        if ($null -eq $ArgumentList) { return }
        return @{ kind = 'fixture-bootstrap'; copied = $script:copied; source = $ArgumentList[1] }
    }
}
$job = $null
try {
    $job = Start-Job -InitializationScript $initialization -ScriptBlock $child[0].ScriptBlock.GetScriptBlock() -ArgumentList (
        '11111111-1111-1111-1111-111111111111', $null, $payload, $pinsJson, ('b' * 40), (Get-InstalledOwnerGuestInvocation).ToString())
    if ($null -eq (Wait-Job -Job $job -Timeout 15)) { throw 'transfer-fixture-timeout' }
    $values = @(Receive-Job -Job $job -ErrorAction Stop)
    if ($job.State -cne 'Completed' -or $values.Count -ne 1) { throw 'transfer-fixture-result-refused' }
    $value = $values[0]
    if ($value.kind -cne 'fixture-bootstrap' -or $value.source -cne ('b' * 40) -or
        @($value.copied).Count -ne $pins.Count -or (Compare-Object $pins.relative $value.copied)) { throw 'transfer-fixture-leaves-refused' }
    $counts = @()
    foreach ($source in @(
        [IO.File]::ReadAllText((Join-Path $Project 'scripts/qualification/installed-owner-guest-bootstrap.ps1')),
        (Get-InstalledOwnerGuestInvocation).ToString()
    )) {
        $parsed = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
        $assignment = $parsed.Find({ param($n)
            $n -is [Management.Automation.Language.AssignmentStatementAst] -and
            $n.Left.Extent.Text -ceq '$pins' -and $n.Right.Extent.Text.Contains('ConvertFrom-Json')
        }, $true)
        if ($errors.Count -or $null -eq $assignment) { throw 'transfer-fixture-source-refused' }
        $counts += & {
            param($Text, $PinsJson)
            $ExpectedPinsJson = $PinsJson
            . ([scriptblock]::Create($Text))
            return [int]$pins.Count
        } $assignment.Extent.Text $pinsJson
    }
    if (@($counts | Where-Object { $_ -ne $pins.Count }).Count) { throw 'transfer-fixture-pin-count-refused' }
    @{ copiedLeaves = $pins.Count; bootstrapPins = $counts[0]; invocationPins = $counts[1];
        noVmOrInstallation = $true } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $job) {
        if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}
