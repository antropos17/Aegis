$ErrorActionPreference='Stop'
# Pure state observations only; no application, installer, registry or VM access.
. (Join-Path $PSScriptRoot 'windows-all-users-update.ps1')
function EmptyState { return @{directoryExists=$false;installKeyExists=$false;registrations=@();shortcuts=@();processes=@()} }
$cases=0
$early=EmptyState;$early.registrations=@('HKLM fixture')
if($early.directoryExists) { throw 'Regression fixture must represent an already removed directory' }
if(-not $early.registrations.Count) { throw 'Original early-check failure did not reproduce' };$cases++
foreach($field in @('directoryExists','installKeyExists','registrations','shortcuts','processes')) {
  $script:observations=0;$script:field=$field
  $proof=Wait-AllUsersRemoval {
    $script:observations++;$state=EmptyState
    if($script:observations -eq 1) { $state[$script:field]=if($script:field -in @('directoryExists','installKeyExists')){$true}else{@('fixture')} }
    return $state
  } -TimeoutMilliseconds 1000 -PollMilliseconds 1
  if(-not $proof.cleared -or $proof.attempts -ne 2 -or $proof.transitions.Count -ne 2) { throw ('Premature removal acceptance: '+$field) };$cases++
}
$proof=Wait-AllUsersRemoval { EmptyState } -TimeoutMilliseconds 1000 -PollMilliseconds 1
if(-not $proof.cleared -or $proof.attempts -ne 1) { throw 'Already removed installation was not accepted' };$cases++
$proof=Wait-AllUsersRemoval { $state=EmptyState;$state.registrations=@('persistent fixture');$state } -TimeoutMilliseconds 10 -PollMilliseconds 1
if($proof.cleared -or $proof.final.registrations.Count -ne 1 -or $proof.transitions.Count -ne 1) { throw 'Persistent residue was hidden or diagnostics unbounded' };$cases++
try { Wait-AllUsersRemoval { throw 'Observation failure' } -TimeoutMilliseconds 10 -PollMilliseconds 1;throw 'Observation error swallowed' }
catch { if($_.Exception.Message -ne 'Observation failure'){throw} };$cases++
try { Wait-AllUsersRemoval { @{} } -TimeoutMilliseconds 10 -PollMilliseconds 1;throw 'Empty observation accepted' }
catch { if($_.Exception.Message -ne 'Machine removal observation incomplete'){throw} };$cases++
@{status='PASS';cases=$cases;earlyDirectoryRemovalRegressionReproduced=$true;nativeUiOrRegistryAccessed=$false} | ConvertTo-Json
