param([string]$Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-guest-phase.ps1')
$sha = 'a' * 40; $digest = 'a' * 64
$actions = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe', 'owner-policy.json', 'enrollment.json', 'inventory.json', 'main-registration.json', 'operator.credential' | ForEach-Object {
    $leaf = $_; foreach ($operation in @('write', 'delete', 'replace')) { $leaf + ':' + $operation }
}) + @('ProtectedSession:rename', 'AEGIS:rename', 'Receipts:rename', 'credential:read')
function Attempt([bool]$Positive) {
    return @{ passed = $true; expectedPositive = $Positive; independentCounter = [int]$Positive;
        independentlyObservedOwner = @{ sid = 'S-1-5-18'; exactProcessExited = $true };
        accountProfile = @{ sid = 'S-1-5-21-1-2-3-1001'; usersGroupSid = 'S-1-5-32-545'; usersMembershipConfirmed = $true };
        native = @{ inspected = $Positive; cleanupConfirmed = $true; launchAllowed = $false; completeE1 = $false; nativeProducerReady = $true;
            bootstrapWriteCompleted = $true; bootstrapEofClosed = $true; supervisorReleased = $true; mainReleased = $Positive; ownedJobsEmpty = $true;
            supervisorPid = 10; mainPid = 11; supervisorExitCode = $(if ($Positive) { 0 } else { 2 }); ownerSid = 'S-1-5-18';
            operatorSid = 'S-1-5-21-1-2-3-1001'; operatorAuthentication = '0000000000000001'; ownerImageSha256 = $digest; mainImageSha256 = $digest; supervisorImageSha256 = $digest } }
}
$names = @(Get-InstalledOwnerGuestPayloadLeaves | Where-Object { $_ -cne 'payload-manifest.json' })
$value = @{ schemaVersion = 1; scope = 'protected-installed-owner-qualification'; location = 'windows11-guest'; sourceSha = $sha; passed = $true;
    failure = $null; cleanupFailure = $null; launchAllowed = $false; completeE1 = $false; completeE11 = $false; interactiveUiQualified = $false;
    inputHashes = @($names | ForEach-Object { @{ path = $_; bytes = 1; sha256 = $digest } }); baseline = (Attempt $false); positive = (Attempt $true); upgrade = (Attempt $true);
    mutation = @{ passed = $true; actorSha256 = $digest; protectedFilesAndAncestorsUnchanged = $true; independentlyObservedPermittedReplacement = $true; independentlyObservedPermittedWrite = $true; independentlyObservedPermittedDelete = $true;
        independentTokenAndJob = @{ operatorSid = 'S-1-5-21-1-2-3-1001'; elevated = $false; enabledAdministrator = $false; adminCapable = $false; powerfulPrivilegesAssigned = $false; strictStandardProfile = $true; integritySid = 'S-1-16-8192'; jobEmpty = $true; exactProcessExited = $true };
        actual = @{ operatorSid = 'S-1-5-21-1-2-3-1001'; passed = $true; administrator = $false; policyReadable = $true; permitted = @{ write = $true; delete = $true; replace = $true }; attempts = @($actions | ForEach-Object { @{ action = $_; denied = $true; win32Error = 5 } }) } };
    rollback = @{ passed = $true; injectedAfterPublication = $true; originalRootAndFilesRestored = $true };
    partial = @{ passed = $true; injectedAfterPublication = $true; serviceAbsent = $true; protectedParentAbsent = $true; accountAbsent = $true };
    uninstall = @{ passed = $true; serviceAbsent = $true; protectedParentAbsent = $true; exactAccountSidAbsent = $true } }
$expectedOs = @{ caption = 'Microsoft Windows 11 Enterprise Evaluation'; version = '10.0.26300'; build = '26300'; architecture = '64-bit' }
$value.os = $expectedOs.Clone()
$pins = @($names | ForEach-Object { @{ relative = $_; bytes = 1; sha256 = $digest } }) + @(@{ relative = 'payload-manifest.json'; bytes = 1; sha256 = $digest })
$envelope = @{ schemaVersion = 1; kind = 'fixed-installed-owner-windows11'; sourceSha = $sha; passed = $true; failureStage = $null; inputPinsVerified = $true;
    inputsHeldThroughClosure = $true; completeE1 = $false; completeE11 = $false; launchAllowed = $false; os = $expectedOs.Clone(); corpus = $value }
switch ($Mode) {
    'green' { }
    'red-without-actors' { $value.baseline.native.nativeProducerReady = $false }
    'cleanup-unknown' { $value.positive.native.cleanupConfirmed = $false }
    'foreign-source' { $value.sourceSha = 'b' * 40 }
    'malformed-boolean' { $value.passed = 'true' }
    'foreign-image' { $value.positive.native.ownerImageSha256 = 'b' * 64 }
    'missing-allowed-effect' { $value.mutation.independentlyObservedPermittedDelete = $false }
    'filtered-admin' { $value.mutation.independentTokenAndJob.adminCapable = $true }
    'missing-users-membership' { $value.positive.accountProfile.usersMembershipConfirmed = $false }
    'duplicate-action' { $value.mutation.actual.attempts[27].action = $value.mutation.actual.attempts[0].action }
    'missing-action' { $value.mutation.actual.attempts = @($value.mutation.actual.attempts | Select-Object -First 27) }
    'foreign-action' { $value.mutation.actual.attempts[27].action = 'foreign:read' }
    'foreign-actor-sid' { $value.mutation.actual.operatorSid = 'S-1-5-21-1-2-3-1002' }
    'foreign-witness-sid' { $value.mutation.independentTokenAndJob.operatorSid = 'S-1-5-21-1-2-3-1002' }
    'array-actor-sid' { $value.mutation.actual.operatorSid = @('S-1-5-21-1-2-3-1001', 'S-1-5-21-1-2-3-1001') }
    'array-witness-sid' { $value.mutation.independentTokenAndJob.operatorSid = @('S-1-5-21-1-2-3-1001', 'S-1-5-21-1-2-3-1001') }
    'foreign-install-sid' { $value.upgrade.accountProfile.sid = 'S-1-5-21-1-2-3-1002'; $value.upgrade.native.operatorSid = $value.upgrade.accountProfile.sid }
    'malformed-win32' { $value.mutation.actual.attempts[0].win32Error = '5' }
    'floating-win32' { $value.mutation.actual.attempts[0].win32Error = [double]5 }
    'action-case' { $value.mutation.actual.attempts[0].action = 'AEGIS-owner.exe:write' }
    'guest-os-mismatch' { $envelope.os.build = '26100' }
    'guest-overclaim' { $envelope.completeE1 = $true }
    default { throw 'receipt-fixture-mode-refused' }
}
@{ corpus = (Test-InstalledOwnerQualificationReceipt $value $sha 'windows11-guest'); guest = (Test-InstalledOwnerGuestResult $envelope $sha $expectedOs $pins) } | ConvertTo-Json -Compress
