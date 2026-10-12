param([string]$Project, [string]$Root)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $Project 'scripts/qualification/installed-owner-phase.ps1')
$file = Join-Path $Root 'actor.bin'
[IO.File]::WriteAllBytes($file, [byte[]]@(65, 66, 67))
$expected = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
$before = (Get-Acl -LiteralPath $file).Sddl
function UnchangedAccess {
    $prior = [Security.AccessControl.RawSecurityDescriptor]::new($before)
    $actual = [Security.AccessControl.RawSecurityDescriptor]::new((Get-Acl -LiteralPath $file).Sddl)
    $flags = -bnot [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited
    return $prior.Owner.Value -ceq $actual.Owner.Value -and $prior.Group.Value -ceq $actual.Group.Value -and
        ($prior.ControlFlags -band $flags) -eq ($actual.ControlFlags -band $flags) -and
        $prior.DiscretionaryAcl.Count -eq $actual.DiscretionaryAcl.Count -and
        $prior.GetSddlForm([Security.AccessControl.AccessControlSections]::Access).Replace('AI', '') -ceq $actual.GetSddlForm([Security.AccessControl.AccessControlSections]::Access).Replace('AI', '')
}
$sid = 'S-1-5-21-1-2-3-1007'
$script:seen = 0; $script:writeRefused = 0
foreach ($fail in @($false, $true)) {
    $caught = $false
    try {
        Invoke-InstalledOwnerActorRead $file $sid $expected {
            $rules = @((Get-Acl -LiteralPath $file).Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ceq $sid })
            if ($rules.Count -ne 1 -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited -or
                [int]$rules[0].FileSystemRights -ne 0x1200a9) { throw 'actor-read-fixture-rights-refused' }
            $script:seen++
            try { [IO.File]::WriteAllBytes($file, [byte[]]@(90)) } catch [IO.IOException] { $script:writeRefused++ }
            if ($fail) { throw 'actor-read-fixture-injected' }
        } | Out-Null
    } catch { if ($_.Exception.Message -cne 'actor-read-fixture-injected') { throw }; $caught = $true }
    if ($caught -ne $fail -or !(UnchangedAccess) -or
        (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) { throw 'actor-read-fixture-restore-refused' }
}
$refused = $false
try { Invoke-InstalledOwnerActorRead $file $sid ('0' * 64) { throw 'unreached' } } catch { $refused = $_.Exception.Message -ceq 'installed-mutation-actor-source-refused' }
if (!$refused -or !(UnchangedAccess)) { throw 'actor-read-fixture-hash-refused' }
@{ observedRxOnly = $script:seen; heldWritesRefused = $script:writeRefused; restoredAfterSuccessAndFailure = $true;
    wrongHashRefused = $true; foreignPrincipalLogon = $false; noInstallation = $true } | ConvertTo-Json -Compress
