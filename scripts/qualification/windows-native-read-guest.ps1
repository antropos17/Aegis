param([Parameter(Mandatory)][ValidateSet('prepare','resume','admission')][string]$Phase)
$ErrorActionPreference='Stop'
$root='C:\aegis-native-read';$bundle=Join-Path $root 'input';$source=Join-Path $root 'source'
$context=Get-Content -LiteralPath (Join-Path $bundle 'context.json') -Raw | ConvertFrom-Json
$result=[ordered]@{schema='aegis-cloud-native-phase/1';status='FAIL';phase=$Phase;sourceSha=$context.sourceSha;sessionId=(Get-Process -Id $PID).SessionId;integritySid=$null;boot=$null;error=$null}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$current=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  if($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $os.BuildNumber -ne '26300' -or $current.UBR -ne 9457 -or $current.EditionID -ne 'EnterpriseEval' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:USERNAME -ne 'AegisSetup' -or $result.sessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'Exact disposable interactive Win11 x64 guest required' }
  $groups=(& ($env:SystemRoot+'\System32\whoami.exe') /groups /fo csv /nh) -join "`n"
  if($LASTEXITCODE -ne 0 -or $groups.Length -gt 64KB -or $groups -notmatch 'S-1-16-8192' -or $groups -match 'S-1-16-12288') { throw 'Limited medium-integrity phase required' }
  $result.integritySid='S-1-16-8192';$result.boot=$os.LastBootUpTime.ToUniversalTime().ToString('o')
  $env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted-hyperv-guest';$env:RUNNER_OS='Windows';$env:RUNNER_ARCH='X64'
  $env:GITHUB_SHA=$context.sourceSha;$env:GITHUB_RUN_ID=$context.runId;$env:GITHUB_RUN_ATTEMPT=$context.attempt
  $env:GITHUB_WORKSPACE=$source;$env:RUNNER_TEMP=$root;$env:CI='true';$env:HUSKY='0'
  $env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $root 'absent-global-gitconfig'
  $env:PATH=(Join-Path $bundle 'runtime')+';'+(Join-Path $bundle 'runtime/git/cmd')+';'+$env:PATH
  $env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
  Remove-Item Env:GH_TOKEN,Env:GITHUB_TOKEN,Env:AEGIS_ETW_QUALIFICATION_HOST,Env:ELECTRON_RUN_AS_NODE,Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  Set-Location -LiteralPath $source
  if((git rev-parse HEAD) -cne $context.sourceSha -or (git rev-parse 'HEAD^{tree}') -cne $context.sourceTree -or (git status --porcelain --untracked-files=normal)) { throw 'Guest source binding changed' }
  $node=Join-Path $bundle 'runtime/node.exe'
  $arguments=@()
  if($Phase -eq 'admission') {
    $arguments=@('scripts/qualification/windows-native-read-probe.mjs','--source-sha',$context.sourceSha,'--candidate',(Join-Path $bundle 'candidate'),'--build-receipt',(Join-Path $bundle 'reboot-build.json'),'--config',(Join-Path $bundle 'etw-builder.json'),'--output',(Join-Path $root 'evidence/admission'))
  } else {
    $arguments=@('tools/development/etw-reboot.mjs','--phase',$Phase,'--source-sha',$context.sourceSha,'--candidate',(Join-Path $bundle 'candidate'),'--build-receipt',(Join-Path $bundle 'reboot-build.json'),'--config',(Join-Path $bundle 'etw-builder.json'),'--output',(Join-Path $root ('evidence/'+$Phase)))
    if($Phase -eq 'resume') { $arguments+=@('--prepared',(Join-Path $root 'evidence/prepare/receipt.json')) }
  }
  & $node @arguments *> (Join-Path $root ($Phase+'.log'))
  if($LASTEXITCODE -ne 0) { throw 'Bounded native-read driver failed; retain its linked receipt' }
  $receipt=Get-Content -LiteralPath (Join-Path $root ('evidence/'+$Phase+'/receipt.json')) -Raw | ConvertFrom-Json
  $expected=if($Phase -eq 'prepare') {'PREPARED'} else {'PASS'}
  if($receipt.status -cne $expected -or $receipt.sourceHead -cne $context.sourceSha) { throw 'Native-read receipt/source mismatch' }
  $result.receiptStatus=$receipt.status;$result.status='PASS'
} catch { $result.error=$_.Exception.Message }
finally { $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root ($Phase+'-done.json')) -Encoding utf8 }
if($result.status -cne 'PASS') { exit 1 }
