Set-StrictMode -Version Latest

# Direct Process.Start retains the creation handle even if the child has already
# exited before this function returns; Start-Process's PID wrapper does not.
function Start-CloudGuestNativeProcess([string]$FilePath, [string[]]$Arguments) {
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $FilePath
    $process.StartInfo.Arguments = $Arguments -join ' '
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try { if (!$process.Start()) { throw 'native-process-start-failed' }; return $process }
    catch { $process.Dispose(); throw }
}

# Drain both pipes concurrently without an unbounded ReadToEnd allocation.
function Invoke-CloudGuestNativeProcess([string]$FilePath, [string[]]$Arguments, [string]$Stdout, [string]$Stderr, [int]$Milliseconds) {
    if ($Milliseconds -lt 1 -or $Milliseconds -gt 30000) { throw 'native-wait-input-invalid' }
    $process = $null; $files = @(); $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        foreach ($path in @($Stdout, $Stderr)) { $files += [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
        $process = Start-CloudGuestNativeProcess $FilePath $Arguments
        $pipes = @($process.StandardOutput.BaseStream, $process.StandardError.BaseStream)
        $reads = @()
        foreach ($pipe in $pipes) {
            $buffer = New-Object byte[] 4096
            $reads += @{ buffer = $buffer; pending = $pipe.ReadAsync($buffer, 0, $buffer.Length); total = 0; ended = $false }
        }
        while (!$process.HasExited -or !$reads[0].ended -or !$reads[1].ended) {
            if ($watch.ElapsedMilliseconds -ge $Milliseconds) { throw 'native-process-deadline' }
            for ($index = 0; $index -lt 2; $index++) {
                $read = $reads[$index]
                if (!$read.ended -and $read.pending.IsCompleted) {
                    $count = $read.pending.GetAwaiter().GetResult()
                    if ($count -eq 0) { $read.ended = $true; continue }
                    $read.total += $count
                    if ($read.total -gt 65536) { throw 'native-output-budget-failed' }
                    $files[$index].Write($read.buffer, 0, $count)
                    $read.pending = $pipes[$index].ReadAsync($read.buffer, 0, $read.buffer.Length)
                }
            }
            Start-Sleep -Milliseconds 1
        }
        return (Wait-CloudGuestNativeProcess $process 1)
    }
    finally {
        try {
            if ($null -ne $process) {
                try { if (!$process.HasExited) { $process.Kill(); [void]$process.WaitForExit(1000) } }
                finally { $process.Dispose() }
            }
        }
        finally { foreach ($file in $files) { $file.Dispose() }; $watch.Stop() }
    }
}

function Wait-CloudGuestNativeProcess([Diagnostics.Process]$Process, [int]$Milliseconds) {
    if ($null -eq $Process -or $Milliseconds -lt 1 -or $Milliseconds -gt 30000) { throw 'native-wait-input-invalid' }
    [void]$Process.Handle
    if (!$Process.WaitForExit($Milliseconds)) {
        if (!$Process.HasExited) { $Process.Kill() }
        throw 'native-process-deadline'
    }
    $Process.WaitForExit()
    $code = $Process.ExitCode
    if ($null -eq $code) { throw 'native-exit-observation-unavailable' }
    return [int]$code
}

function Assert-CloudGuestRunner {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or
        $env:GITHUB_RUN_ID -notmatch '^\d+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$') { throw 'cloud-guest-runner-scope-refused' }
}

function Get-CloudGuestFailureDetails([Exception]$Exception) {
    $current = $Exception; $depth = 0
    while ($null -ne $current.InnerException -and $depth -lt 8) { $current = $current.InnerException; $depth++ }
    # Only source-constant codes may cross the receipt boundary. Arbitrary inner
    # messages (including strings resembling codes) are never published.
    $allowed = @('boot-diagnostic-window-closed', 'boot-key-window-closed', 'boot-owned-vm-mismatch', 'keyboard-query-id-invalid', 'keyboard-owned-vm-not-running', 'exact-vm-keyboard-unavailable', 'keyboard-owner-mismatch',
        'setup-key-result-missing', 'setup-key-return-unconfirmed', 'vm-provider-field-invalid', 'vm-provider-path-invalid',
        'native-wait-input-invalid', 'native-process-start-failed', 'native-process-deadline', 'native-output-budget-failed', 'native-exit-observation-unavailable', 'native-source-budget-failed', 'native-compile-failed',
        'source-head-unavailable', 'source-head-mismatch', 'expected-source-required', 'cloud-disk-headroom-unavailable', 'cloud-hyperv-admin-memory-unavailable', 'script-source-budget-failed',
        'wim-read-open-failed', 'wim-metadata-read-failed', 'wim-metadata-budget-failed', 'wim-image-count-failed', 'wim-exact-edition-unavailable', 'wim-pinned-version-mismatch',
        'media-http-length-failed', 'media-byte-budget-failed', 'media-disk-headroom-failed', 'media-download-incomplete', 'published-media-hash-mismatch', 'pinned-media-volume-unavailable',
        'answer-input-invalid', 'fresh-answer-output-required', 'answer-iso-budget-failed', 'answer-iso-stream-failed', 'fixed-media-source-required',
        'trusted-node-input-invalid', 'node-version-observation-failed', 'host-read-write-control-failed', 'host-delete-control-failed', 'owned-name-preexisting', 'created-identity-unknown', 'native-start-unconfirmed',
        'guest-configure-provider-unknown', 'guest-setup-disk-headroom-failed', 'guest-setup-psdirect-not-ready', 'guest-setup-or-task-deadline', 'guest-bootstrap-failed',
        'guest-edition-version-mismatch', 'guest-readiness-observation-failed', 'guest-transfer-manifest-invalid', 'guest-transfer-hash-mismatch', 'answer-dvd-ejection-unconfirmed', 'media-eject-owner-mismatch', 'media-eject-inventory-unexpected',
        'setup-secret-cleanup-unconfirmed', 'guest-result-budget-failed', 'guest-controls-unconfirmed', 'guest-job-inventory-unavailable', 'trusted-guest-bootstrap-required',
        'job-create', 'job-limits', 'standard-user-create', 'job-assign', 'held-token-open', 'held-token-sid', 'held-token-admin', 'held-token-elevation', 'held-image', 'task-resume', 'task-deadline', 'task-exit', 'task-exit-observation', 'guest-job-closure')
    $parts = $current.Message.Split(':')
    $fixed = $parts.Count -le 2 -and $allowed -ccontains $parts[0] -and ($parts.Count -eq 1 -or $parts[1] -cmatch '^[0-9]{1,10}$')
    $code = if ($fixed) { $current.Message } else { 'bounded-stage-failed' }
    return @{ code = $code; hResult = $current.HResult; exceptionType = $current.GetType().FullName; innerDepth = $depth }
}

function Get-CloudGuestImageMetadata([string]$Text) {
    if ([Text.Encoding]::Unicode.GetByteCount($Text) -gt 1MB) { throw 'wim-metadata-budget-failed' }
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 524288
    $source = [IO.StringReader]::new($Text.TrimStart([char]0xfeff))
    $reader = [Xml.XmlReader]::Create($source, $settings)
    try {
        $xml = [Xml.XmlDocument]::new(); $xml.XmlResolver = $null; $xml.Load($reader)
        $images = @($xml.SelectNodes('/WIM/IMAGE'))
        if ($images.Count -lt 1 -or $images.Count -gt 16) { throw 'wim-image-count-failed' }
        $selected = @($images | Where-Object { $_.NAME -ceq 'Windows 11 Enterprise Evaluation' -and $_.WINDOWS.EDITIONID -ceq 'EnterpriseEval' })
        if ($selected.Count -ne 1) { throw 'wim-exact-edition-unavailable' }
        $image = $selected[0]; $version = $image.WINDOWS.VERSION
        if ($image.WINDOWS.ARCH -ne '9' -or $version.MAJOR -ne '10' -or $version.MINOR -ne '0' -or
            $version.BUILD -ne '26300' -or $version.SPBUILD -ne '9457' -or $image.INDEX -notmatch '^([1-9]|1[0-6])$') { throw 'wim-pinned-version-mismatch' }
        return @{ index = [int]$image.INDEX; name = [string]$image.NAME; edition = [string]$image.WINDOWS.EDITIONID;
            architecture = 'amd64'; version = '10.0.26300.9457'; metadataSource = 'read-only-WIMGAPI-file-information'; imageCount = $images.Count }
    }
    finally { $reader.Dispose(); $source.Dispose() }
}

# Pure answer construction is testable without mounting or creating any VM.
# Passwords are temporary lab credentials; the answer and derived ISO are never artifacts.
function New-CloudGuestAnswerText([int]$Index, [string]$AdminPassword, [string]$TaskPassword) {
    if ($Index -lt 1 -or $Index -gt 16 -or $AdminPassword.Length -lt 24 -or $TaskPassword.Length -lt 24) { throw 'answer-input-invalid' }
    $admin = [Security.SecurityElement]::Escape($AdminPassword)
    $task = [Security.SecurityElement]::Escape($TaskPassword)
    return @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk>
        <CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition><CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition><CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions>
        <ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition><ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions>
      </Disk><WillShowUI>OnError</WillShowUI></DiskConfiguration>
      <ImageInstall><OSImage><InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>$Index</Value></MetaData></InstallFrom><InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo><WillShowUI>OnError</WillShowUI></OSImage></ImageInstall>
      <UserData><AcceptEula>true</AcceptEula><FullName>AEGIS disposable evaluation</FullName><Organization>AEGIS qualification</Organization></UserData>
    </component>
  </settings>
  <settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>AEGIS-EVAL</ComputerName><TimeZone>UTC</TimeZone></component></settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <OOBE><HideEULAPage>true</HideEULAPage><HideOEMRegistrationScreen>true</HideOEMRegistrationScreen><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE>
      <UserAccounts><LocalAccounts>
        <LocalAccount wcm:action="add"><Name>AegisSetup</Name><DisplayName>AEGIS setup</DisplayName><Group>Administrators</Group><Password><Value>$admin</Value><PlainText>true</PlainText></Password></LocalAccount>
        <LocalAccount wcm:action="add"><Name>AegisTask</Name><DisplayName>AEGIS task</DisplayName><Group>Users</Group><Password><Value>$task</Value><PlainText>true</PlainText></Password></LocalAccount>
      </LocalAccounts></UserAccounts>
      <AutoLogon><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>AegisSetup</Username><Password><Value>$admin</Value><PlainText>true</PlainText></Password></AutoLogon>
    </component>
  </settings>
</unattend>
"@
}

function New-CloudGuestAnswerIso([string]$Directory, [string]$Destination, [string]$AnswerText) {
    Assert-CloudGuestRunner
    if ((Test-Path -LiteralPath $Directory) -or (Test-Path -LiteralPath $Destination) -or [Text.Encoding]::UTF8.GetByteCount($AnswerText) -gt 64KB) { throw 'fresh-answer-output-required' }
    New-Item -ItemType Directory -Path $Directory | Out-Null
    [IO.File]::WriteAllText((Join-Path $Directory 'Autounattend.xml'), $AnswerText, [Text.UTF8Encoding]::new($false))
    $image = $null; $root = $null; $result = $null; $stream = $null
    try {
        $image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
        $image.FileSystemsToCreate = 3; $image.VolumeName = 'AEGISANSWER'
        $root = $image.Root; $root.AddTree($Directory, $false)
        $result = $image.CreateResultImage(); $stream = $result.ImageStream
        return [CloudGuestMetadata]::CopyIso($stream, $Destination)
    }
    finally {
        foreach ($value in @($stream, $result, $root, $image)) { if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) | Out-Null } }
    }
}
