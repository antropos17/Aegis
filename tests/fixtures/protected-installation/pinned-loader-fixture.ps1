param([string]$Project)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$before = Get-ExecutionPolicy
$tokens = $null; $errors = $null
$path = Join-Path $Project 'scripts/qualification/installed-owner-guest-bootstrap.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'loader-fixture-parse-refused' }
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-InstalledOwnerPinnedModule' }, $true)
. ([scriptblock]::Create($fn.Extent.Text))
$modules = @(
    @{ path = 'scripts/installation/protected-install-files.ps1'; deps = @() },
    @{ path = 'scripts/installation/protected-install-transaction.ps1'; deps = @() },
    @{ path = 'scripts/installation/protected-vm-provider.ps1'; deps = @() },
    @{ path = 'scripts/installation/protected-vm.ps1'; deps = @() },
    @{ path = 'scripts/installation/protected-installation.ps1'; deps = @('protected-install-files.ps1', 'protected-install-transaction.ps1', 'protected-vm-provider.ps1', 'protected-vm.ps1') },
    @{ path = 'scripts/qualification/installed-owner-phase.ps1'; deps = @('../installation/protected-installation.ps1') }
)
foreach ($module in $modules) {
    $path = Join-Path $Project $module.path
    $block = Get-InstalledOwnerPinnedModule ([IO.File]::ReadAllText($path)) $path $module.deps
    . $block
}
Initialize-ProtectedInstallNative
$rejected = 0
foreach ($text in @(". 'unapproved.ps1'", '. (Get-Content dynamic.ps1)', 'function Broken {')) {
    try { Get-InstalledOwnerPinnedModule $text 'X:\pinned\rejected.ps1' @() | Out-Null }
    catch { $rejected++ }
}
if ($rejected -ne 3 -or $before -ne (Get-ExecutionPolicy)) { throw 'loader-fixture-boundary-refused' }
@{ policyUnchanged = $true; policyRestricted = ($before -eq 'Restricted');
    nativeLoaded = ($null -ne ('ProtectedInstallFile' -as [type]));
    corpusDefined = ($null -ne (Get-Command Invoke-InstalledOwnerQualification));
    rejectedImportsOrSyntax = $rejected; noInstallation = $true } | ConvertTo-Json -Compress
