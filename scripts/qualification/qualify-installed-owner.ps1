param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
# This script creates an account only on a disposable GitHub-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted runner required' }
$Root = [IO.Path]::GetFullPath($Root)
if ($env:GITHUB_RUN_ID -notmatch '^\d+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$') { throw 'Invalid run identity' }
$expected=Join-Path ([IO.Path]::GetPathRoot($env:RUNNER_TEMP)) ('aegis-owner-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT)
if (-not $Root.Equals($expected,[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $Root -Force).LinkType) { throw 'Exact runner-local task root required' }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'Allocated root required' }
$receipt = [ordered]@{ schema='aegis-installed-owner/1'; source=(& git rev-parse HEAD); status='FAIL'; installed=$false; differentSid=$false; ownerRefused=$false; accountRemoved=$false; profileRemoved=$false; uninstalled=$false; cleanup=$false }
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
    $plan = @{ ownerSid=$ownerSid; foreignSid=$foreignSid; launcher=(Join-Path $install 'resources/sidecar/aegis-owner-console.exe'); exe=$installedExe; node=(Get-Command node).Source; driver=(Join-Path $PSScriptRoot 'packaged-owner-delete.mjs'); helper=$helper; source=$receipt.source; profile=$profile; policy=(Join-Path $Root 'delete/reject/policy.json'); request=(Join-Path $Root 'delete/reject/request.json'); endpoint=(Join-Path $foreign 'endpoint.json'); result=(Join-Path $foreign 'result.json') }
    $plan | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $foreign 'plan.json') -Encoding utf8
    $script = Join-Path $foreign 'attempt.ps1'
    @'
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'plan.json') -Raw | ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if($sid -ne $plan.foreignSid -or $sid -eq $plan.ownerSid) { throw 'Actual foreign token mismatch' }
# A freshly loaded disposable profile has not run Explorer. Materialize its
# registered special folders before requiring the production known-folder gate.
# Do not substitute fixture paths or relax the launcher's profile validation.
$actualProfile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile,[Environment+SpecialFolderOption]::DoNotVerify)
$users=Join-Path ([IO.Path]::GetPathRoot($env:WINDIR)) 'Users'
if([string]::IsNullOrEmpty($actualProfile) -or -not [IO.Path]::GetFullPath($actualProfile).StartsWith($users+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $actualProfile -Leaf) -notlike 'AegisQ*'){throw 'Disposable known-folder profile boundary refused'}
foreach($folder in @([Environment+SpecialFolder]::ApplicationData,[Environment+SpecialFolder]::LocalApplicationData)) {
    $path=[Environment]::GetFolderPath($folder,[Environment+SpecialFolderOption]::DoNotVerify)
    if([string]::IsNullOrEmpty($path) -or -not [IO.Path]::GetFullPath($path).StartsWith($actualProfile+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Disposable known-folder path refused'}
    $null=[IO.Directory]::CreateDirectory($path)
    if([string]::IsNullOrEmpty([Environment]::GetFolderPath($folder))){throw 'Disposable known-folder initialization failed'}
}
# A positive control under the same real foreign token must reach a genuine
# console preview using its own anchors, before a foreign-owner refusal counts.
$positive=Join-Path $PSScriptRoot 'positive'
& $plan.node $plan.driver $plan.exe $positive $plan.helper $plan.source reject
if($LASTEXITCODE -ne 0){throw 'Foreign-token positive console control failed'}
$accepted=Get-Content -LiteralPath (Join-Path $positive 'receipt.json') -Raw|ConvertFrom-Json
if($accepted.status -ne 'PASS' -or $accepted.cases.Count -ne 1 -or -not $accepted.cases[0].reviewObserved -or -not $accepted.cases[0].noOwnedProcesses){throw 'Foreign-token positive evidence incomplete'}
foreach($name in @('appdata','localappdata','userprofile','home','temp')) {
    $anchor=Join-Path (Join-Path $plan.profile $name) '.aegis-owner-profile-anchor'
    $null=[IO.File]::ReadAllBytes($anchor)
    $owner=[IO.File]::GetAccessControl($anchor).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if($owner -ne $plan.ownerSid -or $owner -eq $sid){throw 'Original owner mismatch or unreadable fixture'}
}
$negative=Join-Path $PSScriptRoot 'negative'
New-Item -ItemType Directory -Path $negative|Out-Null
@{launcher=$plan.launcher;profile=$plan.profile;policy=$plan.policy;request=$plan.request;endpoint=$plan.endpoint}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $negative 'plan.json') -Encoding utf8
& $plan.helper outer $negative
if($LASTEXITCODE -ne 0){throw 'Foreign-token refusal observer failed'}
$refused=Get-Content -LiteralPath (Join-Path $negative 'console.json') -Raw|ConvertFrom-Json
@{sid=$sid;exitCode=$refused.exitCode;endpointCreated=(Test-Path -LiteralPath $plan.endpoint);positiveConsole=$true;negativeForced=$refused.forced;negativePreview=$refused.reviewObserved;originalAnchorsReadable=$true} | ConvertTo-Json | Set-Content -LiteralPath $plan.result -Encoding utf8
if($refused.exitCode -ne 2 -or $refused.forced -or $refused.reviewObserved -or (Test-Path -LiteralPath $plan.endpoint)) { exit 1 }
'@ | Set-Content -LiteralPath $script -Encoding utf8
    $credential = [PSCredential]::new(($env:COMPUTERNAME + '\' + $account), $password)
    $target=Join-Path $Root 'delete/reject/owned-target.txt'
    $before=(Get-FileHash -LiteralPath $target).Hash
    Wait-Owned (Start-Process -FilePath "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -Credential $credential -LoadUserProfile -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-File', ('"' + $script + '"')) -WorkingDirectory $foreign -PassThru -WindowStyle Hidden) 90000
    $result=Get-Content -LiteralPath $plan.result -Raw | ConvertFrom-Json
    if ($result.sid -ne $foreignSid -or $result.exitCode -ne 2 -or -not $result.positiveConsole -or -not $result.originalAnchorsReadable -or $result.negativeForced -or $result.negativePreview -or $result.endpointCreated -or (Get-FileHash -LiteralPath $target).Hash -ne $before) { throw 'Different-account refusal oracle failed' }
    $receipt.differentSid=$true; $receipt.ownerRefused=$true
    @{differentSid=$true;positiveConsole=$true;originalAnchorsReadable=$true;exitCode=$result.exitCode;endpointCreated=$false;targetUnchanged=$true;scope='Same actual second-account token accepts its own profile through real console/MCP, then refuses readable original-owner anchors before endpoint creation. No human authentication claim.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'foreign-result.json')
    $receipt.status='PASS'
} catch {
    $receipt.error=$_.Exception.Message
    throw
} finally {
    if ($created) {
        try {
            $ownedProfiles=@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$foreignSid+"'"))
            foreach($ownedProfile in $ownedProfiles) {
                $path=[IO.Path]::GetFullPath($ownedProfile.LocalPath)
                $users=[IO.Path]::GetFullPath((Join-Path $env:SystemDrive 'Users')).TrimEnd('\')+'\'
                if($ownedProfile.Loaded -or $ownedProfile.SID -ne $foreignSid -or $foreignSid -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or -not $path.StartsWith($users,[StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path $path -Leaf).StartsWith($account,[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $path -Force).LinkType){throw 'Disposable account profile cleanup boundary refused'}
                Remove-CimInstance -InputObject $ownedProfile
                if(Test-Path -LiteralPath $path){throw 'Disposable account profile remains'}
            }
            $receipt.profileRemoved=(@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$foreignSid+"'")).Count -eq 0)
            Remove-LocalUser -Name $account
            $receipt.accountRemoved=($null -eq (Get-LocalUser -Name $account -ErrorAction SilentlyContinue))
        } catch { $receipt.accountCleanupError=$_.Exception.Message; $receipt.status='FAIL' }
    }
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
    $receipt.cleanup=($remaining.Count -eq 0 -and $receipt.uninstalled -and (-not $created -or ($receipt.accountRemoved -and $receipt.profileRemoved)))
    if (-not $receipt.cleanup) { $receipt.status='FAIL' }
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Root 'installed-receipt.json')
    Get-PSDrive C,D | Select-Object Name,Free
    if ($receipt.status -ne 'PASS') { exit 1 }
}
