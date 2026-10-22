# Installer lab only: bounded screenshots of a fresh synthetic Windows setup,
# before application/profile inputs are transferred. Shared W7 capture limits stay unchanged.
function Save-InstallerSetupDiagnostic([string]$Id,[string]$Name,[string]$VmRoot,[string]$Evidence,[int]$Index) {
  Assert-CloudGuestRunner
  if($Index -lt 1 -or $Index -gt 4 -or $Id -cnotmatch '^[a-f0-9-]{36}$' -or $Name -cnotmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$') { throw 'Setup diagnostic scope refused' }
  $expectedRoot='D:\aegis-installer-x64-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT+'-'
  if(-not $VmRoot.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($Evidence) -ne (Join-Path (Split-Path $VmRoot) 'evidence')) { throw 'Setup diagnostic output scope refused' }
  $job=Start-Job -ArgumentList $Id,$Name,$VmRoot,$Evidence,$Index -ScriptBlock {
    param($Id,$Name,$VmRoot,$Evidence,$Index)
    $ErrorActionPreference='Stop'
    $result=@{index=$Index;at=[DateTime]::UtcNow.ToString('o');status='UNKNOWN';vmId=$Id;beforeInputTransfer=$true}
    try {
      $vm=Get-VM -Id ([guid]$Id)
      $actual=[IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\');$expected=[IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
      if($vm.Id.ToString() -cne $Id -or $vm.Name -cne $Name -or ($actual -ne $expected -and -not $actual.StartsWith($expected+'\',[StringComparison]::OrdinalIgnoreCase))) { throw 'Setup diagnostic VM mismatch' }
      $result.state=$vm.State.ToString();$result.cpuUsage=$vm.CPUUsage;$result.uptimeSeconds=$vm.Uptime.TotalSeconds
      if($vm.State -ne 'Running') { return $result }
      $namespace='root\virtualization\v2'
      $system=Get-WmiObject -Namespace $namespace -Class Msvm_ComputerSystem -Filter ("Name='"+$Id+"'")
      if($system.Name -cne $Id -or $system.CreationClassName -ne 'Msvm_ComputerSystem') { throw 'Setup diagnostic system mismatch' }
      $settings=@($system.GetRelated('Msvm_VirtualSystemSettingData') | Where-Object { $_.VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized' -and $_.VirtualSystemIdentifier -eq $Id })
      if($settings.Count -ne 1) { throw 'Setup diagnostic settings mismatch' }
      $service=Get-WmiObject -Namespace $namespace -Class Msvm_VirtualSystemManagementService
      $input=$service.GetMethodParameters('GetVirtualSystemThumbnailImage')
      $input.TargetSystem=$settings[0].__PATH;$input.WidthPixels=[uint16]640;$input.HeightPixels=[uint16]480
      $capture=$service.InvokeMethod('GetVirtualSystemThumbnailImage',$input,$null)
      $result.returnCode=[uint32]$capture.ReturnValue
      $bytes=$capture.ImageData
      if($result.returnCode -ne 0 -or $bytes -isnot [byte[]] -or $bytes.Length -lt 614400 -or $bytes.Length -gt 614404) { throw 'Setup thumbnail unavailable' }
      # Preserve exact provider bytes; do not guess the meaning of extra bytes.
      $file='windows-setup-'+$Index+'.rgb565'
      $path=Join-Path $Evidence $file
      if(Test-Path -LiteralPath $path) { throw 'Fresh diagnostic file required' }
      [IO.File]::WriteAllBytes($path,$bytes)
      $result.file=$file;$result.width=640;$result.height=480;$result.bytes=$bytes.Length
      $result.sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();$result.status='CAPTURED'
    } catch { $result.errorKind=$_.Exception.GetType().Name;$result.hresult=$_.Exception.HResult }
    return $result
  }
  try {
    if($null -eq (Wait-Job $job -Timeout 15)) { return @{index=$Index;status='DIAGNOSTIC_TIMEOUT'} }
    $values=@(Receive-Job $job -ErrorAction Stop)
    if($values.Count -ne 1) { throw 'Unexpected setup diagnostic result' }
    return $values[0]
  } finally {
    if($job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }
}
