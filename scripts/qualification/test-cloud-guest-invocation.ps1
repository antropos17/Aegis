param([string]$SupportRoot = $PSScriptRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $SupportRoot 'cloud-guest-vm.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'invocation-support-syntax-invalid' }
$function = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-CloudGuestBootstrapInvocation' }, $false))
if ($function.Count -ne 1) { throw 'invocation-helper-not-unique' }
$fixedPath = @($function[0].FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -ceq 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-bootstrap.ps1' }, $true))
if ($fixedPath.Count -ne 1) { throw 'invocation-fixed-path-not-unique' }
$temp = [IO.Path]::GetFullPath($env:TEMP)
if ($env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted' -and $env:RUNNER_OS -ceq 'Windows' -and (Test-Path -LiteralPath 'D:\')) { $temp = 'D:\' }
if (!$temp.StartsWith('X:\', [StringComparison]::OrdinalIgnoreCase) -and !$temp.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'spacious-invocation-test-temp-required' }
$root = Join-Path $temp ('aegis-invocation-' + [guid]::NewGuid().ToString('N'))
$fixture = Join-Path $root 'fixed-bootstrap.ps1'
New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
$helper = $function[0].Extent.Text
$offset = $fixedPath[0].Extent.StartOffset - $function[0].Extent.StartOffset
$helper = $helper.Remove($offset, $fixedPath[0].Extent.Text.Length).Insert($offset, ("'" + $fixture.Replace("'", "''") + "'"))
$helper64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
$body = @'
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
function Require([bool]$Value) { if (!$Value) { throw 'invocation-control-failed' } }
$helper = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('HELPER64'))
. ([scriptblock]::Create($helper))
$path = 'FIXTUREPATH'
$before = (Get-ExecutionPolicy).ToString(); Require ($before -ceq 'Restricted')
$id = '11111111-1111-1111-1111-111111111111'; $password = 'dummy-secret-never-publish'; $passed = 0
function WriteSource([string]$Source) {
    [IO.File]::WriteAllText($path, $Source, [Text.UTF8Encoding]::new($false))
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
$valid = 'param([string]$TaskPassword) if($TaskPassword -cne "dummy-secret-never-publish"){throw "argument-control"}; return @{ schemaVersion=1; passed=$true; task=@{passed=$true} }'
$hash = WriteSource $valid
$refused = $false; $type = $null; $hresult = $null; $category = $null
try { & $path -TaskPassword $password | Out-Null }
catch { $refused = $true; $type = $_.Exception.GetType().Name; $hresult = $_.Exception.HResult; $category = [int]$_.CategoryInfo.Category }
Require ($refused -and $type -ceq 'PSSecurityException'); $passed++
$entry = Get-CloudGuestBootstrapInvocation
$value = & $entry $password $id $hash
Require ($value.task.passed -eq $true -and $value.bootstrapInvocation.phase -ceq 'fixed-source-returned' -and
    $value.bootstrapInvocation.invocationAttempted -eq $true -and $value.bootstrapInvocation.executionPolicy -ceq 'Restricted'); $passed++
foreach ($mode in @('wrong-hash', 'nonhex-hash', 'wrong-vmid', 'parse-failure', 'invalid-utf8', 'oversized', 'malformed-return', 'missing-task', 'nonboolean-task', 'thrown-secret')) {
    $hash = WriteSource $valid; $vm = $id; $phase = 'fixed-source-validation'
    switch ($mode) {
        'wrong-hash' { $hash = '0' * 64 }
        'nonhex-hash' { $hash = 'z' * 64 }
        'wrong-vmid' { $vm = 'different-vm' }
        'parse-failure' { $hash = WriteSource 'param([string]$TaskPassword) @{' ; $phase = 'fixed-source-parse' }
        'invalid-utf8' {
            [IO.File]::WriteAllBytes($path, [byte[]]@(195,40)); $sha=[Security.Cryptography.SHA256]::Create()
            try { $hash=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-','').ToLowerInvariant() } finally {$sha.Dispose()}
        }
        'oversized' { $hash = WriteSource ('#' + ('x' * 65536)) }
        'malformed-return' { $hash = WriteSource 'param([string]$TaskPassword) return "dummy-secret-never-publish"'; $phase = 'fixed-source-returned' }
        'missing-task' { $hash = WriteSource 'param([string]$TaskPassword) return @{passed=$true}'; $phase = 'fixed-source-returned' }
        'nonboolean-task' { $hash = WriteSource 'param([string]$TaskPassword) return @{task=@{passed="yes"}}'; $phase = 'fixed-source-returned' }
        'thrown-secret' { $hash = WriteSource 'param([string]$TaskPassword) throw "dummy-secret-never-publish"'; $phase = 'fixed-source-invocation' }
    }
    $result = & (Get-CloudGuestBootstrapInvocation) $password $vm $hash
    Require ($result.passed -eq $false -and $result.task.passed -eq $false -and $result.launchAllowed -eq $false -and
        $result.bootstrapInvocation.phase -ceq $phase -and $null -ne $result.bootstrapInvocation.hResult)
    $json = $result | ConvertTo-Json -Depth 5 -Compress
    Require ($json.Length -le 2048 -and !$json.Contains($password) -and !$json.Contains($path))
    Require ($result.bootstrapInvocation.exceptionKind -cin @('RuntimeException','PSSecurityException','UnauthorizedAccessException','MethodInvocationException','ParseException','CommandNotFoundException','ItemNotFoundException','ParameterBindingException','other'))
    $passed++
}
$hash = WriteSource 'param([string]$TaskPassword) return @{schemaVersion=1;passed=$false;task=@{passed=$false}}'
$result = & (Get-CloudGuestBootstrapInvocation) $password $id $hash
Require ($result.task.passed -eq $false -and $result.bootstrapInvocation.phase -ceq 'fixed-source-returned'); $passed++
$after = (Get-ExecutionPolicy).ToString(); Require ($after -ceq $before)
@{cases=$passed; passed=$passed; policyBefore=$before; policyAfter=$after; baselineFileException=$type;
    baselineFileHResult=$hresult; baselineFileCategory=$category; scope='actual-extracted-helper-test-only-fixed-path-no-VM-accounts-or-policy-changes'} | ConvertTo-Json -Compress
'@
$body = $body.Replace('HELPER64', $helper64).Replace('FIXTUREPATH', $fixture.Replace("'", "''"))
$bodyPath = Join-Path $root 'child-control.txt'
[IO.File]::WriteAllText($bodyPath, $body, [Text.UTF8Encoding]::new($false))
$loader = "& ([scriptblock]::Create([IO.File]::ReadAllText('" + $bodyPath.Replace("'", "''") + "')))"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($loader))
$info = [Diagnostics.ProcessStartInfo]::new((Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'))
$info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Restricted -EncodedCommand ' + $encoded
$info.UseShellExecute = $false; $info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
$info.EnvironmentVariables['TEMP'] = $root; $info.EnvironmentVariables['TMP'] = $root
$info.EnvironmentVariables['PSModulePath'] = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'
$process = $null
try {
    $process = [Diagnostics.Process]::Start($info); $handle = $process.Handle
    if ($handle -eq [IntPtr]::Zero -or !$process.WaitForExit(15000)) {
        if (!$process.HasExited) { $process.Kill(); [void]$process.WaitForExit(2000) }
        throw 'invocation-child-deadline'
    }
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
    if ($stdout.Length -gt 4096 -or $stderr.Length -gt 8192 -or $process.ExitCode -ne 0 -or $stderr.Length -ne 0) {
        throw 'invocation-child-controls-failed'
    }
    $result = $stdout | ConvertFrom-Json
    if ($result.cases -ne 13 -or $result.passed -ne 13) { throw 'invocation-child-count-invalid' }
    Write-Output $stdout.Trim()
}
finally {
    if ($null -ne $process) { $process.Dispose() }
    if (Test-Path -LiteralPath $fixture) {
        $file = Get-Item -LiteralPath $fixture -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 65537 -or $file.FullName -cne $fixture) { throw 'invocation-fixture-cleanup-scope-invalid' }
        Remove-Item -LiteralPath $fixture -Force
    }
    $bodyFile = Get-Item -LiteralPath $bodyPath -Force
    if ($bodyFile.PSIsContainer -or ($bodyFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $bodyFile.Length -gt 32KB -or $bodyFile.FullName -cne $bodyPath) { throw 'invocation-body-cleanup-scope-invalid' }
    Remove-Item -LiteralPath $bodyPath
    $directory = Get-Item -LiteralPath $root -Force
    if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @(Get-ChildItem -LiteralPath $root -Force).Count -ne 0) { throw 'invocation-directory-cleanup-scope-invalid' }
    Remove-Item -LiteralPath $root
}
