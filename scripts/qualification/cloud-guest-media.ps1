Set-StrictMode -Version Latest

function Assert-CloudGuestRunner {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or
        $env:GITHUB_RUN_ID -notmatch '^\d+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$') { throw 'cloud-guest-runner-scope-refused' }
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
