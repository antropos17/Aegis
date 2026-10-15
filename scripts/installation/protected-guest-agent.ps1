Set-StrictMode -Version Latest

# Administrative PS Direct is bound to the created VMId; no IP, network share,
# guest result file or ordinary caller can choose the destination or executable.
function Invoke-ProtectedGuestAgent($Context, [pscredential]$Administrator, [pscredential]$Agent, $Package, [string[]]$Arguments = @(), [int]$Milliseconds = 30000) {
    Assert-ProtectedInstallAdministrator; $owned = $Context.vmProvision
    if ($null -eq $owned -or $owned.unknown -or !$owned.ContainsKey('guest') -or $owned.guest.state -cne 'running' -or $owned.guest.agentConsumed -or
        $Milliseconds -lt 100 -or $Milliseconds -gt 120000 -or $Arguments.Count -gt 16 -or $Package -isnot [hashtable] -or $Package.Count -ne 3 -or
        @($Package.Keys | Where-Object { $_ -cnotin @('path', 'bytes', 'sha256') }).Count -ne 0 -or $Package.path -isnot [string] -or
        $Package.bytes -isnot [long] -or $Package.bytes -lt 1 -or $Package.bytes -gt 4MB -or $Package.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'protected-guest-agent-request-refused' }
    Assert-ProtectedGuestConfiguration $owned 'Running'
    $held = [ProtectedInstallFile]::new($Package.path, $false, $false)
    try {
        if ($held.Hash(4MB) -cne $Package.sha256) { throw 'protected-guest-agent-digest-refused' }
        $payload = $held.Read(4MB)
        if ($payload.Length -ne $Package.bytes) { throw 'protected-guest-agent-digest-refused' }
    } finally { $held.Dispose() }
    $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')); $sources = @{}
    foreach ($relative in @('scripts/installation/ProtectedGuestAgent.cs', 'scripts/installation/ProtectedGuestDesktop.cs', 'sidecar/session/GuestJobNative.cs')) {
        $code = [ProtectedInstallFile]::new((Join-Path $project $relative), $false, $false)
        try { $sources[[IO.Path]::GetFileName($relative)] = $code.Read(64KB) } finally { $code.Dispose() }
    }
    $nonce = [guid]::NewGuid().ToString('N'); $owned.guest.agentConsumed = $true
    Write-ProtectedVmJournal $owned 'pending-agent.json' @{ schemaVersion = 1; vmId = $owned.vmId; nonce = $nonce; executableSha256 = $Package.sha256 }
    $worker = Start-Job -ArgumentList $owned.vmId, $Administrator, $Agent, $payload, $Package.sha256, $sources, $Arguments, $Milliseconds, $nonce -ScriptBlock {
        param($Id, $Administrator, $Agent, $Payload, $Digest, $Sources, $Arguments, $Milliseconds, $Nonce)
        $ErrorActionPreference = 'Stop'; $session = $null
        try {
            $env:PSModulePath = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\Modules'
            $ready = [Diagnostics.Stopwatch]::StartNew()
            while ($null -eq $session -and $ready.ElapsedMilliseconds -lt 60000) {
                try { $session = New-PSSession -VMId ([guid]$Id) -Credential $Administrator -ErrorAction Stop }
                catch { Start-Sleep -Milliseconds 1000 }
            }
            if ($null -eq $session) { throw 'protected-guest-channel-unavailable' }
            if ($session.VMId.ToString('D') -cne $Id -or $session.State -ne 'Opened') { throw 'protected-guest-channel-refused' }
            Invoke-Command -Session $session -ArgumentList $Agent, $Payload, $Digest, $Sources, $Arguments, $Milliseconds, $Nonce, $Id -ScriptBlock {
                param($Agent, $Payload, $Digest, $Sources, $Arguments, $Milliseconds, $Nonce, $Id)
                $ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
                $env:PSModulePath = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\Modules'
                if (!(Get-CimInstance Win32_ComputerSystem).HypervisorPresent -or (Get-ItemProperty 'HKLM:\SYSTEM\Setup').SystemSetupInProgress -ne 0 -or
                    !$Agent.UserName -or $Agent.UserName -cnotmatch '^[A-Za-z][A-Za-z0-9]{0,19}$') { throw 'protected-guest-readiness-refused' }
                $users = @(Get-LocalUser -Name $Agent.UserName -ErrorAction Stop)
                if ($users.Count -ne 1 -or !$users[0].Enabled -or @((Get-LocalGroupMember -SID S-1-5-32-544) | Where-Object { $_.SID.Value -ceq $users[0].SID.Value }).Count -ne 0) { throw 'protected-guest-account-refused' }
                $sid = $users[0].SID.Value
                # Enforce the guest principal's entire writable NTFS volume,
                # including descendants and alternate directories, before release.
                # This changes only the explicitly provisioned guest, never the host.
                $quota = New-Object -ComObject Microsoft.DiskQuota
                try {
                    $quota.Initialize('C:\', $true); $quota.QuotaState = 2
                    $entry = $quota.AddUser($env:COMPUTERNAME + '\' + $Agent.UserName)
                    $entry.QuotaThreshold = 256MB; $entry.QuotaLimit = 512MB
                    if ($quota.QuotaState -ne 2 -or [long]$entry.QuotaLimit -ne 512MB -or [long]$entry.QuotaUsed -ge 512MB) { throw 'protected-guest-quota-refused' }
                } finally { if ($null -ne $entry) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($entry) }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($quota) }
                # Fresh private roots only. Existing roots are never repaired or adopted.
                if (Test-Path -LiteralPath C:\ProgramData\AEGIS) { throw 'protected-guest-fresh-root-required' }
                $acl = [Security.AccessControl.DirectorySecurity]::new()
                $acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;' + $sid + ')')
                [IO.DirectoryInfo]::new('C:\ProgramData\AEGIS').Create($acl)
                $root = 'C:\ProgramData\AEGIS\Guest\' + $Nonce
                [IO.DirectoryInfo]::new($root).Create($acl)
                $work = Join-Path $root 'work'; $workAcl = [Security.AccessControl.DirectorySecurity]::new()
                $workAcl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;' + $sid + ')')
                [IO.DirectoryInfo]::new($work).Create($workAcl)
                $env:TEMP = $root; $env:TMP = $root
                $pins = [Collections.Generic.List[object]]::new()
                try {
                    $paths = @()
                    foreach ($name in @('ProtectedGuestAgent.cs', 'ProtectedGuestDesktop.cs', 'GuestJobNative.cs')) {
                        $path = Join-Path $root $name
                        $output = [IO.FileStream]::new($path, 'CreateNew', 'Write', 'None')
                        try { $output.Write($Sources[$name], 0, $Sources[$name].Length); $output.Flush($true) } finally { $output.Dispose() }
                        $pins.Add([IO.File]::Open($path, 'Open', 'Read', 'Read')); $paths += $path
                    }
                    Add-Type -Path $paths
                    $executable = Join-Path $root 'agent.exe'
                    $output = [IO.FileStream]::new($executable, 'CreateNew', 'Write', 'None')
                    try { $output.Write($Payload, 0, $Payload.Length); $output.Flush($true) } finally { $output.Dispose() }
                    $password = $Agent.GetNetworkCredential().Password
                    try { $exit = [ProtectedGuestAgent]::Run($executable, $Digest, $Arguments, $work, $Agent.UserName, $password, $sid, $Milliseconds) }
                    finally { $password = $null }
                    return @{ schemaVersion = 1; vmId = $Id; nonce = $Nonce; executableSha256 = $Digest; exitCode = [long]$exit; jobClosed = $true; standardToken = $true; diskQuotaBytes = [long]512MB }
                } finally { foreach ($pin in $pins) { $pin.Dispose() }; [Array]::Clear($Payload, 0, $Payload.Length) }
            }
        } finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
    }
    try {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $deadline = $Milliseconds + 120000
        while ($worker.State -cin @('Running', 'NotStarted') -and $watch.ElapsedMilliseconds -lt $deadline) {
            if ([long](Get-PSDrive -Name ([IO.Path]::GetPathRoot($owned.root.PathName).Substring(0, 1))).Free -lt 4GB) { throw 'protected-guest-host-headroom-refused' }
            Wait-Job -Job $worker -Timeout 1 | Out-Null
        }
        if ($worker.State -cin @('Running', 'NotStarted')) { throw 'protected-guest-agent-settlement-unknown' }
        $rows = @(Receive-Job -Job $worker -ErrorAction Stop)
        if ($worker.State -cne 'Completed' -or $rows.Count -ne 1 -or $rows[0].schemaVersion -ne 1 -or $rows[0].vmId -cne $owned.vmId -or
            $rows[0].nonce -cne $nonce -or $rows[0].executableSha256 -cne $Package.sha256 -or $rows[0].jobClosed -isnot [bool] -or !$rows[0].jobClosed -or
            $rows[0].standardToken -isnot [bool] -or !$rows[0].standardToken -or $rows[0].diskQuotaBytes -isnot [long] -or $rows[0].diskQuotaBytes -ne 512MB -or $rows[0].exitCode -isnot [long] -or $rows[0].exitCode -lt 0 -or $rows[0].exitCode -gt [uint32]::MaxValue) { throw 'protected-guest-agent-result-refused' }
        Assert-ProtectedGuestConfiguration $owned 'Running'
        Write-ProtectedVmJournal $owned 'settled-agent.json' $rows[0]
        return $rows[0]
    } finally {
        if ($worker.State -eq 'Running') { Stop-Job -Job $worker }
        Remove-Job -Job $worker -Force; [Array]::Clear($payload, 0, $payload.Length)
    }
}
