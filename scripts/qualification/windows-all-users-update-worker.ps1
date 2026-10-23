$ErrorActionPreference='Stop'
$qa='C:\aegis-installer-qa\all-users-update'
$proof=[ordered]@{status='RUNNING';action=$null;sourceSha=$null;token=$null;process=$null;exitCode=$null;error=$null}
try {
  $inputRoot='C:\aegis-installer-qa\input'
  $context=Get-Content -LiteralPath (Join-Path $inputRoot 'context.json') -Raw | ConvertFrom-Json
  $os=Get-CimInstance Win32_OperatingSystem
  if($context.scenario -ne 'all-users-update' -or $env:USERNAME -ne 'AegisSetup' -or -not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -le 0 -or $os.Caption -notmatch 'Windows 11' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Owned interactive all-users update guest required' }
  $request=Get-Content -LiteralPath (Join-Path $qa 'request.json') -Raw | ConvertFrom-Json
  if($request.sourceSha -ne $context.sourceSha -or $request.action -notin @('baseline-install','final-uninstall')) { throw 'Unexpected all-users update worker request' }
  $proof.action=$request.action;$proof.sourceSha=$context.sourceSha
  $support=Join-Path $inputRoot 'source/scripts/qualification'
  Add-Type -Path (Join-Path $support 'InstallerProcessObservation.cs')
  $proof.token=[InstallerProcessObservation]::Inspect($PID)
  if($proof.token.elevated -ne 1 -or $proof.token.integritySid -ne 'S-1-16-12288') { throw 'Machine setup/cleanup requires the isolated elevated worker' }
  $install='C:\Program Files\aegis'
  $file=[IO.Path]::GetFullPath($request.file)
  if($request.action -eq 'baseline-install') {
    if(Test-Path -LiteralPath $install) { throw 'Baseline installation directory already exists' }
    if(-not $file.StartsWith($qa+'\previous\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file).Hash -ne '9494799164b2c73a195b4fbe6c243a697025a3b119350488828e8288117d72b3') { throw 'Baseline installer pin/ownership mismatch' }
    $arguments=@('/S','/allusers',('/D='+$install))
  } else {
    $expected=@(Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe' -File)
    if($expected.Count -ne 1 -or $file -ine $expected[0].FullName) { throw 'Owned machine uninstaller mismatch' }
    $arguments=@('/S','/allusers')
  }
  $env:TEMP=Join-Path $qa 'temp';$env:TMP=$env:TEMP
  $process=Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $identity=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.Id)
  $proof.process=@{pid=$process.Id;path=$file;created=$identity.CreationDate.ToUniversalTime().ToString('o');arguments=$arguments;token=[InstallerProcessObservation]::Inspect($process.Id)}
  if(-not $process.WaitForExit(180000)) { throw 'Machine setup/cleanup deadline exceeded' }
  $process.Refresh();$proof.exitCode=$process.ExitCode
  if($process.ExitCode -ne 0) { throw ('Machine setup/cleanup failed: '+$process.ExitCode) }
  $proof.status='PASS'
} catch { $proof.status='FAIL';$proof.error=$_.Exception.Message }
finally {
  $leaf=if($proof.action){$proof.action}else{'invalid-request'}
  $proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $qa ('evidence/machine-'+$leaf+'.json')) -Encoding UTF8
}
if($proof.status -ne 'PASS') { exit 1 }
