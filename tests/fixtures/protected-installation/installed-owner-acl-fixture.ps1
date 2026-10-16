# Bounded control-contract regression; no protected paths, services or accounts.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
function Require([bool]$Value) { if (!$Value) { throw 'acl-control-fixture-failed' } }
function Access([string]$Path, [uint32]$Rights, [bool]$Directory) {
    $arguments = [object[]]::new(3)
    $arguments[0] = $Path; $arguments[1] = $Rights; $arguments[2] = $Directory
    return $access.Invoke($null, $arguments)
}
$rows = @()
foreach ($leaf in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe', 'owner-policy.json', 'enrollment.json', 'inventory.json', 'main-registration.json', 'operator.credential', 'registered-vm.json', 'registered-operation.json', 'fixed-fixture.json')) {
    foreach ($operation in @('write', 'delete', 'replace', 'writeDac', 'writeOwner')) { $rows += @{ action = $leaf + ':' + $operation; denied = $true; win32Error = 5 } }
}
foreach ($directory in @('ProtectedSession', 'AEGIS', 'Receipts')) {
    foreach ($operation in @('rename', 'writeDac', 'writeOwner')) { $rows += @{ action = $directory + ':' + $operation; denied = $true; win32Error = 5 } }
}
$rows += @{ action = 'credential:read'; denied = $true; win32Error = 5 }
Require ($rows.Count -eq 65 -and (Test-InstalledOwnerMutationActions $rows))
foreach ($operation in @('writeDac', 'writeOwner')) {
    $target = @($rows | Where-Object { $_.action -ceq ('owner-policy.json:' + $operation) })[0]
    Require (!(Test-InstalledOwnerMutationActions @($rows | Where-Object { $_ -ne $target })))
    $target.win32Error = 2; Require (!(Test-InstalledOwnerMutationActions $rows))
    $target.win32Error = 0; Require (!(Test-InstalledOwnerMutationActions $rows))
    $target.win32Error = 5; $target.denied = 'true'; Require (!(Test-InstalledOwnerMutationActions $rows))
    $target.denied = $true; Require (!(Test-InstalledOwnerMutationActions (@($rows) + @($target))))
}
# Compile the actual actor but invoke only its kernel access helper on exact
# disposable scratch objects. Main never executes; no protected ACL is probed.
Add-Type -Path @((Join-Path $PSScriptRoot 'InstalledOwnerMutationActor.cs'), (Join-Path $PSScriptRoot '../../../scripts/qualification/CloudGuestDesktop.cs'))
$access = [InstalledOwnerMutationActor].GetMethod('Access', [Reflection.BindingFlags]'NonPublic,Static')
$scratch = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path ('out/acl-control-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$file = Join-Path $scratch 'access.txt'
try {
    $acl = Get-Acl -LiteralPath $scratch
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $scratch -AclObject $acl
    [IO.File]::WriteAllText($file, 'disposable')
    foreach ($rights in @([uint32]0x40000, [uint32]0x80000)) {
        Require ((Access $file $rights $false) -eq 0)
        Require ((Access $scratch $rights $true) -eq 0)
        Require ((Access (Join-Path $scratch 'absent') $rights $false) -eq 2)
    }
    @{ contractActions = $rows.Count; malformedSecurityDenialsRefused = $true; scratchSecurityAccessGranted = $true; nativeAclQualification = $false } | ConvertTo-Json -Compress
} finally {
    # Exact created leaves only; never recurse through a computed directory.
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    Remove-Item -LiteralPath $scratch
}
