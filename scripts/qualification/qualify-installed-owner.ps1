param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
# This script creates an account only on a disposable GitHub-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted runner required' }
$Root = [IO.Path]::GetFullPath($Root)
if (-not $Root.StartsWith(([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Runner-local root required' }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'Allocated root required' }
$receipt = [ordered]@{ schema='aegis-installed-owner/1'; source=(& git rev-parse HEAD); status='FAIL'; installed=$false; differentSid=$false; ownerRefused=$false; accountRemoved=$false; uninstalled=$false; cleanup=$false }
$account = 'AegisQ' + [Guid]::NewGuid().ToString('N').Substring(0,10)
$created = $false
$installedExe = Join-Path $Root 'installed/AEGIS - AI Monitoring & Threat Detection.exe'
$install = Split-Path -Parent $installedExe
function Wait-Owned([Diagnostics.Process]$Process, [int]$Milliseconds) {
    if (-not $Process.WaitForExit($Milliseconds)) { $Process.Kill($true); $Process.WaitForExit(); throw 'Qualification process deadline exceeded' }
    if ($Process.ExitCode -ne 0) { throw ('Qualification process failed: ' + $Process.ExitCode) }
}
try {
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $Root 'package') -Filter '*Setup*.exe' -File)
    if ($installers.Count -ne 1 -or (Test-Path -LiteralPath $install)) { throw 'One fresh installer required' }
    $receipt.installerSha256 = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Wait-Owned (Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', ('/D=' + $install)) -PassThru -WindowStyle Hidden) 120000
    $archive = Join-Path $install 'resources/app.asar'
    if (-not (Test-Path -LiteralPath $installedExe) -or -not (Test-Path -LiteralPath $archive)) { throw 'Installed payload missing' }
    $builtArchive = Join-Path $Root 'package/win-unpacked/resources/app.asar'
    if ((Get-FileHash -LiteralPath $archive).Hash -ne (Get-FileHash -LiteralPath $builtArchive).Hash) { throw 'Installed archive differs from candidate' }
    $receipt.installed=$true
    $receipt.archiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $helper = Join-Path $Root 'PackagedOwnerConsole.exe'
    & "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /warnaserror+ /platform:x64 /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll "/out:$helper" (Join-Path $PSScriptRoot 'PackagedOwnerConsole.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native observer compile failed' }
    & node (Join-Path $PSScriptRoot 'packaged-owner-delete.mjs') $installedExe (Join-Path $Root 'delete') $helper
    if ($LASTEXITCODE -ne 0) { throw 'Installed delete qualification failed' }
    # The second principal reads only disposable public QA scripts/results. The selected
    # profile and its markers retain the original owner's SID; no ownership is changed.
    $foreign = Join-Path $Root 'foreign'
    New-Item -ItemType Directory -Path $foreign | Out-Null
    $password = ConvertTo-SecureString ('Q!' + [Guid]::NewGuid().ToString('N') + 'a9') -AsPlainText -Force
    $user = New-LocalUser -Name $account -Password $password -AccountNeverExpires -UserMayNotChangePassword
    $created=$true
    $ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $foreignSid=$user.SID.Value
    if ($ownerSid -eq $foreignSid) { throw 'Second account SID matches owner' }
    # Grant traverse/read to this disposable QA root, and write only to the foreign
    # result directory. Original profile ownership remains unchanged and is checked natively.
    & icacls $Root /grant ('*' + $foreignSid + ':(OI)(CI)RX') /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'QA root read ACL failed' }
    & icacls $foreign /grant ('*' + $foreignSid + ':(OI)(CI)M') /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'QA result ACL failed' }
    $profile = Join-Path $Root 'delete/reject/profile'
    $plan = @{ ownerSid=$ownerSid; foreignSid=$foreignSid; launcher=(Join-Path $install 'resources/sidecar/aegis-owner-console.exe'); profile=$profile; policy=(Join-Path $Root 'delete/reject/policy.json'); request=(Join-Path $Root 'delete/reject/request.json'); endpoint=(Join-Path $foreign 'endpoint.json'); result=(Join-Path $foreign 'result.json') }
    $plan | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $foreign 'plan.json') -Encoding utf8
    $script = Join-Path $foreign 'attempt.ps1'
    @'
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'plan.json') -Raw | ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if($sid -ne $plan.foreignSid -or $sid -eq $plan.ownerSid) { throw 'Actual foreign token mismatch' }
& $plan.launcher --profile-root $plan.profile --action-mcp-delete-review $plan.policy $plan.request $plan.endpoint
$code=$LASTEXITCODE
@{sid=$sid;exitCode=$code;endpointCreated=(Test-Path -LiteralPath $plan.endpoint)} | ConvertTo-Json | Set-Content -LiteralPath $plan.result -Encoding utf8
if($code -ne 2 -or (Test-Path -LiteralPath $plan.endpoint)) { exit 1 }
'@ | Set-Content -LiteralPath $script -Encoding utf8
    $credential = [PSCredential]::new(($env:COMPUTERNAME + '\' + $account), $password)
    $target=Join-Path $Root 'delete/reject/owned-target.txt'
    $before=(Get-FileHash -LiteralPath $target).Hash
    Wait-Owned (Start-Process -FilePath "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -Credential $credential -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-File', ('"' + $script + '"')) -WorkingDirectory $foreign -PassThru -WindowStyle Hidden) 20000
    $result=Get-Content -LiteralPath $plan.result -Raw | ConvertFrom-Json
    if ($result.sid -ne $foreignSid -or $result.exitCode -ne 2 -or $result.endpointCreated -or (Get-FileHash -LiteralPath $target).Hash -ne $before) { throw 'Different-account refusal oracle failed' }
    $receipt.differentSid=$true; $receipt.ownerRefused=$true
    @{differentSid=$true;exitCode=$result.exitCode;endpointCreated=$false;targetUnchanged=$true;scope='Actual second-account token; original-owner selected profile refused before endpoint creation. No human authentication claim.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'foreign-result.json')
    $receipt.status='PASS'
} catch {
    $receipt.error=$_.Exception.Message
    throw
} finally {
    if ($created) { Remove-LocalUser -Name $account; $receipt.accountRemoved=($null -eq (Get-LocalUser -Name $account -ErrorAction SilentlyContinue)) }
    if (Test-Path -LiteralPath $install) {
        $uninstallers=@(Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe' -File)
        if ($uninstallers.Count -eq 1) {
            try { Wait-Owned (Start-Process -FilePath $uninstallers[0].FullName -ArgumentList '/S' -PassThru -WindowStyle Hidden) 90000 } catch { $receipt.uninstallError=$_.Exception.Message }
        }
        $until=[DateTime]::UtcNow.AddSeconds(15)
        while ((Test-Path -LiteralPath $installedExe) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
    }
    $receipt.uninstalled= -not (Test-Path -LiteralPath $installedExe)
    $remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith(($install + '\'),[StringComparison]::OrdinalIgnoreCase) })
    $receipt.cleanup=($remaining.Count -eq 0 -and $receipt.uninstalled -and (-not $created -or $receipt.accountRemoved))
    if (-not $receipt.cleanup) { $receipt.status='FAIL' }
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Root 'installed-receipt.json')
    Get-PSDrive C,D | Select-Object Name,Free
    if ($receipt.status -ne 'PASS') { exit 1 }
}
