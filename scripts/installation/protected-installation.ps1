Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'protected-install-files.ps1')
. (Join-Path $PSScriptRoot 'protected-install-transaction.ps1')

function Assert-ProtectedInstallAdministrator {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or $PSVersionTable.PSEdition -ne 'Desktop' -or ![Environment]::Is64BitProcess) { throw 'protected-installer-elevated-windows51-x64-required' }
}
function Assert-ProtectedInstallAccount($Context, [bool]$RequireUsers = $true) {
    $accounts = @(Get-LocalUser -Name $Context.operatorAccount -ErrorAction Stop)
    if ($accounts.Count -ne 1 -or $accounts[0].SID.Value -cne $Context.operatorSid) { throw 'protected-owned-account-association-refused' }
    $administrators = @(Get-LocalGroupMember -SID 'S-1-5-32-544')
    if (@($administrators | Where-Object { $_.SID.Value -ceq $Context.operatorSid }).Count) { throw 'protected-operator-administrator-refused' }
    $users = @(Get-LocalGroupMember -SID 'S-1-5-32-545')
    if ($RequireUsers -and @($users | Where-Object { $_.SID.Value -ceq $Context.operatorSid }).Count -ne 1) { throw 'protected-operator-users-membership-required' }
}
function Assert-ProtectedInstallation($Association) {
    if ($Association.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
    Assert-ProtectedInstallAccount $Association
    $Association.parent.Recheck(); $Association.receipts.Recheck(); $Association.service.Recheck()
    Update-ProtectedInstallRuntimeRows $Association.stage
    $children = @(Get-ChildItem -LiteralPath $script:ProtectedInstallParent -Force)
    $allowed = @($Association.stage.root.PathName, $Association.receipts.PathName)
    if ($Association.ContainsKey('rollback') -and $null -ne $Association.rollback) { $allowed += $Association.rollback.root.PathName }
    if ($null -ne $Association.control) { $allowed += $Association.control.PathName }
    foreach ($child in $children) { if ($child.FullName -cnotin $allowed) { throw 'protected-owned-parent-unknown-child' } }
}

# Reusable administrative API; the qualification wrapper separately restricts its
# host and transport. No administrator can adopt a preexisting account/root/service.
function Set-ProtectedInstallCredential($Context) {
    Add-Type -AssemblyName System.Security
    $secret = [Text.Encoding]::Unicode.GetBytes($Context.password)
    try { $Context.credential = [Security.Cryptography.ProtectedData]::Protect($secret, [Text.Encoding]::ASCII.GetBytes('AEGIS-installed-owner-credential-v1'), [Security.Cryptography.DataProtectionScope]::LocalMachine) }
    finally { [Array]::Clear($secret, 0, $secret.Length) }
}
function New-ProtectedInstallation([string]$SourceRoot, $Manifest, [string]$OperatorAccount, [string]$Password, [bool]$FailAfterPublish = $false, [hashtable]$Journal = @{}) {
    $Journal.operation = 'administrator'; $Journal.failure = $null; $Journal.createdSid = $null; $Journal.createdRoots = @(); $Journal.published = $false
    $Journal.service = @{ name = 'AegisProtectedSessionOwner'; creationAttempted = $false; created = $false }
    $Journal.cleanup = @{ state = 'pending'; serviceAbsent = $null; protectedParentAbsent = $null; exactAccountSidAbsent = $null; failure = $null }
    $Journal.accountCreationAttempted = $false; $Journal.association = $null
    $inputs = @{}
    $installParent = $script:ProtectedInstallParent; $installRoot = $script:ProtectedInstallRoot
    $context = @{ manifest = $Manifest; inputs = $inputs; operatorAccount = $OperatorAccount; password = $Password; operatorSid = $null;
        installId = [guid]::NewGuid().ToString('N'); selectionId = [guid]::NewGuid().ToString('N'); selectionEpoch = [guid]::NewGuid().ToString('N');
        credential = $null; parent = $null; receipts = $null; stage = $null; service = $null; ancestors = [Collections.Generic.List[object]]::new(); receiptRows = @(); attemptedReceiptPaths = @(); rollback = $null; control = $null; controlRows = @(); cleanupUnknown = $false }
    try {
        Assert-ProtectedInstallAdministrator
        $Journal.operation = 'native-initialize'; Initialize-ProtectedInstallNative
        $Journal.operation = 'input'
        if ($OperatorAccount -cnotmatch '^AegisOp[a-f0-9]{12}$' -or $Password.Length -lt 24 -or $Password.Length -gt 64) { throw 'protected-install-input-refused' }
        $inputs = Read-ProtectedInstallInputs $SourceRoot $Manifest; $context.inputs = $inputs
        $Journal.operation = 'ancestor'
        foreach ($path in @('C:\', 'C:\ProgramData')) {
            $held = [ProtectedInstallFile]::new($path, $true, $false); $context.ancestors.Add($held)
            if (!$held.Protected($true)) { throw 'protected-ancestor-acl-refused' }
        }
        $Journal.operation = 'fresh-association'
        if (Test-Path -LiteralPath $script:ProtectedInstallParent) { throw 'protected-install-parent-preexisting' }
        if (![ProtectedInstallService]::Absent()) { throw 'protected-install-service-preexisting' }
        if (@(Get-LocalUser | Where-Object { $_.Name -ceq $OperatorAccount }).Count) { throw 'protected-install-account-preexisting' }
        $ops = @{
            validate = { $Journal.operation = 'validate'; foreach ($held in $context.ancestors) { $held.Recheck() } }.GetNewClosure()
            stage = {
              try {
                $Journal.operation = 'account-create'; $Journal.accountCreationAttempted = $true
                $account = New-LocalUser -Name $context.operatorAccount -Password (ConvertTo-SecureString $context.password -AsPlainText -Force) -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword
                $context.operatorSid = $account.SID.Value
                $Journal.operatorSid = $context.operatorSid; $Journal.createdSid = $context.operatorSid; $Journal.association = $context
                $Journal.operation = 'account-membership'
                if (@(Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object { $_.SID.Value -ceq $context.operatorSid }).Count -eq 0) {
                    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
                }
                Assert-ProtectedInstallAccount $context
                $Journal.usersGroupSid = 'S-1-5-32-545'; $Journal.usersMembershipConfirmed = $true
                $Journal.operation = 'parent-create'; $context.parent = New-ProtectedInstallDirectory $installParent $context.operatorSid
                $Journal.createdRoots += @{ role = 'parent'; volume = $context.parent.Volume; fileId = $context.parent.FileId }
                $Journal.operation = 'receipts-create'; $context.receipts = New-ProtectedInstallDirectory (Join-Path $installParent 'Receipts') $context.operatorSid $true
                $Journal.createdRoots += @{ role = 'receipts'; volume = $context.receipts.Volume; fileId = $context.receipts.FileId }
                $Journal.operation = 'credential-protect'
                Set-ProtectedInstallCredential $context
                $Journal.operation = 'stage-create'; $context.stage = New-ProtectedInstallStage $context 1 ([guid]::NewGuid().ToString('N'))
                $Journal.stage = @{ volume = $context.stage.root.Volume; fileId = $context.stage.root.FileId; revision = 1; epoch = $context.stage.epoch }
                $Journal.createdRoots += @{ role = 'stage'; volume = $context.stage.root.Volume; fileId = $context.stage.root.FileId }
                return $context.stage
              } catch { Set-ProtectedInstallFailure $Journal $_; if (Test-ProtectedInstallCleanupUnknown $_) { $context.cleanupUnknown = $true }; throw }
            }.GetNewClosure()
            publish = { param($stage)
                $Journal.operation = 'publish'
                try { Move-ProtectedInstallStage $stage $installRoot; $stage.published = $true; $Journal.published = $true; if ($FailAfterPublish) { throw 'protected-qualified-partial-fault' } }
                catch { Set-ProtectedInstallFailure $Journal $_; if (Test-ProtectedInstallCleanupUnknown $_) { $context.cleanupUnknown = $true }; throw }
            }.GetNewClosure()
            register = {
                $Journal.operation = 'service-create'; $Journal.service.creationAttempted = $true
                try { $context.service = [ProtectedInstallService]::Create(); $Journal.service.created = $true; return $context.service }
                catch { Set-ProtectedInstallFailure $Journal $_; if (Test-ProtectedInstallCleanupUnknown $_) { $context.cleanupUnknown = $true }; throw }
            }.GetNewClosure()
            verify = { param($stage, $service)
                $Journal.operation = 'verify'
                try { Assert-ProtectedInstallStage $stage; $service.Recheck(); Assert-ProtectedInstallAccount $context }
                catch { Set-ProtectedInstallFailure $Journal $_; throw }
            }.GetNewClosure()
            unregister = { param($service) $Journal.operation = 'service-remove'; $service.Stop(); $service.Delete(); $context.service = $null }.GetNewClosure()
            remove = { param($stage, $published)
                $Journal.operation = 'stage-remove'
                if ($context.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
                if (![ProtectedInstallService]::Absent()) { $context.cleanupUnknown = $true; throw 'protected-service-creation-cleanup-unknown' }
                Remove-ProtectedInstallStage $stage $published; $context.stage = $null
            }.GetNewClosure()
        }
        Invoke-ProtectedInstallTransaction $ops | Out-Null
        $Journal.cleanup.state = 'installed'; $Journal.association = $context
        return $context
    }
    catch {
        $original = $_
        Set-ProtectedInstallFailure $Journal $_
        if (Test-ProtectedInstallCleanupUnknown $_) { $context.cleanupUnknown = $true }
        $Journal.association = $context
        # A pre-effect refusal never selects a preexisting account/root/service.
        if (!$Journal.accountCreationAttempted) {
            foreach ($held in $context.ancestors) { $held.Dispose() }; $context.ancestors.Clear(); $context.password = $null
            $Journal.cleanup.state = 'confirmed-no-effects'; throw $original
        }
        # Unknown service/root states forbid further cleanup or account deletion.
        try {
            if ($context.cleanupUnknown -or $null -ne $context.service -or ![ProtectedInstallService]::Absent() -or ($null -ne $context.stage -and (Test-Path -LiteralPath $context.stage.root.PathName))) { throw 'protected-installation-cleanup-unknown' }
            $Journal.operation = 'ancillary-remove'; Remove-ProtectedInstallAncillary $context
            $Journal.operation = 'absence-confirm'
            $Journal.cleanup.serviceAbsent = [ProtectedInstallService]::Absent()
            $Journal.cleanup.protectedParentAbsent = !(Test-Path -LiteralPath $installParent)
            $Journal.cleanup.exactAccountSidAbsent = @((Get-LocalUser) | Where-Object { $_.SID.Value -ceq $Journal.createdSid -or $_.Name -ceq $OperatorAccount }).Count -eq 0
            if (!$Journal.cleanup.serviceAbsent -or !$Journal.cleanup.protectedParentAbsent -or !$Journal.cleanup.exactAccountSidAbsent) { throw 'protected-uninstall-absence-unconfirmed' }
            $Journal.cleanup.state = $(if ($null -eq $Journal.createdSid) { 'confirmed-no-effects' } else { 'confirmed' })
        } catch {
            $context.cleanupUnknown = $true; $Journal.cleanup.state = 'unknown'; $Journal.cleanup.failure = Get-ProtectedInstallFailure $_ $Journal.operation
            throw 'protected-installation-cleanup-unknown'
        }
        throw $original
    }
    finally { foreach ($bytes in $inputs.Values) { [Array]::Clear($bytes, 0, $bytes.Length) } }
}

function Assert-ProtectedInstallAncillary($Context) {
    if ($Context.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
    if ($null -ne $Context.control) {
        $Context.control.Recheck(); $files = @(Get-ChildItem -LiteralPath $Context.control.PathName -Force)
        if ($files.Count -ne $Context.controlRows.Count -or $files.Count -ne 3 -or @($files | Where-Object { $_.FullName -cnotin @($Context.controlRows.path) }).Count) { throw 'protected-control-unknown-child' }
        foreach ($row in $Context.controlRows) { Assert-ProtectedInstallSnapshot $row }
    }
    if ($null -ne $Context.receipts) {
        $Context.receipts.Recheck(); $files = @(Get-ChildItem -LiteralPath $Context.receipts.PathName -Force)
        if ($files.Count -ne $Context.receiptRows.Count -or $files.Count -gt 8 -or @($files | Where-Object { $_.FullName -cnotin @($Context.receiptRows.path) }).Count) { throw 'protected-receipt-unknown-child' }
        foreach ($row in $Context.receiptRows) { Assert-ProtectedInstallSnapshot $row }
    }
}
function Remove-ProtectedInstallAncillary($Context) {
    if ($Context.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
    Assert-ProtectedInstallAncillary $Context
    if ($null -ne $Context.control) {
        $Context.control.Recheck(); $files = @(Get-ChildItem -LiteralPath $Context.control.PathName -Force)
        if ($files.Count -ne 3 -or @($files | Where-Object { $_.Name -cnotin @('actor-result.json', 'write-marker.txt', 'replace-original.txt') -or $_.Length -gt 16KB }).Count) { throw 'protected-control-unknown-child' }
        foreach ($row in $Context.controlRows) {
            $held = [ProtectedInstallFile]::new($row.path, $false, $true)
            try { if ($held.FileId -cne $row.fileId -or $held.Volume -cne $row.volume -or $held.Sddl -cne $row.sddl -or $held.Hash(16KB) -cne $row.sha256) { throw 'protected-control-association-refused' }; $held.Delete() } finally { $held.Dispose() }
        }
        $Context.control.Delete(); $Context.control = $null
    }
    if ($null -ne $Context.receipts) {
        $files = @(Get-ChildItem -LiteralPath $Context.receipts.PathName -Force)
        if ($files.Count -ne $Context.receiptRows.Count -or $files.Count -gt 8) { throw 'protected-receipt-unknown-child' }
        foreach ($row in $Context.receiptRows) { Assert-ProtectedInstallSnapshot $row }
        foreach ($row in $Context.receiptRows) {
            $held = [ProtectedInstallFile]::new($row.path, $false, $true)
            try { if ($held.FileId -cne $row.fileId -or $held.Volume -cne $row.volume -or $held.Hash(4MB) -cne $row.sha256) { throw 'protected-receipt-association-refused' }; $held.Delete() }
            finally { $held.Dispose() }
        }
        $Context.receipts.Delete(); $Context.receipts = $null
    }
    if ($null -ne $Context.parent) {
        $Context.parent.Recheck()
        if (@(Get-ChildItem -LiteralPath $Context.parent.PathName -Force).Count -ne 0) { throw 'protected-parent-unknown-child' }
    }
    if ($null -ne $Context.operatorSid) {
        Assert-ProtectedInstallAccount $Context $false
        Remove-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($Context.operatorSid))
        if (@(Get-LocalUser | Where-Object { $_.SID.Value -ceq $Context.operatorSid -or $_.Name -ceq $Context.operatorAccount }).Count) { throw 'protected-account-removal-unconfirmed' }
        $Context.operatorSid = $null
    }
    # Keep the exact empty owned parent as a fresh-install exclusion until the
    # original account SID removal is independently confirmed.
    if ($null -ne $Context.parent) {
        $Context.parent.Recheck()
        if (@(Get-ChildItem -LiteralPath $Context.parent.PathName -Force).Count -ne 0) { throw 'protected-parent-unknown-child' }
        $Context.parent.Delete(); $Context.parent = $null
    }
    foreach ($held in $Context.ancestors) { $held.Dispose() }; $Context.ancestors.Clear()
    $Context.password = $null
}

function Remove-ProtectedInstallation($Association) {
    Assert-ProtectedInstallAdministrator
    $ops = @{
        validate = { param($selected)
            Assert-ProtectedInstallIdleUpgrade $selected.service
            Assert-ProtectedInstallation $selected; Assert-ProtectedInstallAncillary $selected
            if ($null -ne $selected.rollback) { throw 'protected-uninstall-rollback-pending' }
        }.GetNewClosure()
        stop = { param($selected) $selected.service.Stop(); Update-ProtectedInstallRuntimeRows $selected.stage }.GetNewClosure()
        unregister = { param($service) $service.Delete(); $Association.service = $null }.GetNewClosure()
        remove = { param($stage, $published) Remove-ProtectedInstallStage $stage $published; $Association.stage = $null }.GetNewClosure()
        account = { param($selected) Remove-ProtectedInstallAncillary $selected }.GetNewClosure()
    }
    try { Invoke-ProtectedUninstallTransaction $ops $Association }
    catch { $Association.cleanupUnknown = $true; throw }
    if ((Test-Path -LiteralPath $script:ProtectedInstallParent) -or ![ProtectedInstallService]::Absent()) { throw 'protected-uninstall-absence-unconfirmed' }
}

function Update-ProtectedInstallation($Association, [string]$SourceRoot, $Manifest, [bool]$FailAfterPublish = $false) {
    Assert-ProtectedInstallAdministrator; Assert-ProtectedInstallIdleUpgrade $Association.service
    Assert-ProtectedInstallation $Association
    $inputs = Read-ProtectedInstallInputs $SourceRoot $Manifest
    $priorManifest = $Association.manifest; $old = $Association.stage; $priorInputs = $Association.inputs
    $Association.manifest = $Manifest; $Association.inputs = $inputs
    $rollbackPath = Join-Path $script:ProtectedInstallParent ('Rollback-' + [guid]::NewGuid().ToString('N'))
    $installParent = $script:ProtectedInstallParent; $installRoot = $script:ProtectedInstallRoot
    try {
        $ops = @{
            validate = { param($selected) Assert-ProtectedInstallIdleUpgrade $selected.service; Assert-ProtectedInstallation $selected; if ($null -ne $selected.rollback) { throw 'protected-upgrade-already-pending' } }.GetNewClosure()
            stage = { New-ProtectedInstallStage $Association ([uint32]($old.revision + 1)) ([guid]::NewGuid().ToString('N')) }.GetNewClosure()
            stop = { param($selected) $selected.service.Stop() }.GetNewClosure()
            saveOld = { param($selected) Move-ProtectedInstallStage $old $rollbackPath; $selected.rollback = $old }.GetNewClosure()
            publish = { param($stage) Move-ProtectedInstallStage $stage $installRoot }.GetNewClosure()
            verify = { param($stage, $service) Assert-ProtectedInstallStage $stage; $service.Recheck(); if ($FailAfterPublish) { throw 'protected-qualified-upgrade-fault' } }.GetNewClosure()
            unpublish = { param($stage) Move-ProtectedInstallStage $stage (Join-Path $installParent ('Staging-' + [guid]::NewGuid().ToString('N'))) }.GetNewClosure()
            restore = { param($selected) Move-ProtectedInstallStage $old $installRoot; $selected.rollback = $null }.GetNewClosure()
            restart = { param($selected) $selected.service.Recheck() }.GetNewClosure()
            remove = { param($stage, $published) Remove-ProtectedInstallStage $stage $published }.GetNewClosure()
            commit = { param($selected, $stage) $selected.stage = $stage; Remove-ProtectedInstallStage $old $true; $selected.rollback = $null }.GetNewClosure()
        }
        return Invoke-ProtectedUpgradeTransaction $ops $Association
    }
    catch {
        if ($_.Exception.Message -like '*protected-upgrade-*-unknown*') { $Association.cleanupUnknown = $true }
        if (!$Association.cleanupUnknown) { $Association.manifest = $priorManifest; $Association.inputs = $priorInputs }
        throw
    }
    finally { foreach ($bytes in $inputs.Values) { [Array]::Clear($bytes, 0, $bytes.Length) } }
}
