# Protected installed-owner qualification

This slice installs the maintained native owner, session Program and fixed headless
main controller on a fresh GitHub-hosted Windows runner and its newly owned Windows
11 VM. The Electron interface remains unelevated. The native controller uses a
newly logged-on standard account; session 0 qualification covers the fixed native
controller and does not establish interactive Electron UI behavior. Hosted runtime
qualification remains pending until the reviewed corpus produces actual receipts.

## Resource and rollback plan

The host is the fresh `windows-2025` runner selected by the existing
`enforcement-native-qualification.yml` `cloud-windows11` mode. Provisioning refuses
any preexisting `C:\ProgramData\AEGIS`, `AegisProtectedSessionOwner` service or
selected `AegisOp<12 hex>` local account. `C:\` and `C:\ProgramData` remain unchanged;
their actual owners and DACLs must satisfy the maintained ancestor validator.

New resources are `C:\ProgramData\AEGIS`, its `ProtectedSession`, `Receipts` and
bounded staging/rollback siblings and one disposable `MutationControl` child;
the demand-start own-process LocalSystem SCM
service `AegisProtectedSessionOwner`, and one standard local account whose exact
SID is retained. Only that fresh SID is explicitly added to built-in Users
`S-1-5-32-545`, and actual membership is verified before logon. No user rights or
global group policies change. The service command is the quoted fixed
`C:\ProgramData\AEGIS\ProtectedSession\aegis-owner.exe`, without arguments.
The protected root contains only the pinned `aegis-owner.exe`, `aegis-session.exe`,
`aegis-main.exe`, canonical owner policy, canonical enrollment, a DPAPI LocalMachine
credential, one-selection inventory and native main registration. Credential ciphertext permits only
SYSTEM and Administrators read/write; LocalMachine DPAPI is not itself a boundary
against a local account able to read the ciphertext. Other protected files permit
only the exact operator read/execute and trusted administrator/SYSTEM full control.

The paired mutation control is an operator-writable fixed leaf below the new
`C:\ProgramData\AEGIS\MutationControl`. Source and replacement target use the
same C volume so a cross-volume refusal cannot masquerade as ACL denial. The
existing exact `D:\aegis-cloud-guest-<run>-<attempt>` scratch root holds bounded
source payloads and compilation logs. The owner uses only its private
native setup/result channels. No network endpoint or firewall/default setting is
added. The existing lab still owns its new zero-NIC Windows 11 VM and retains the
offline task, stdio, cancellation, canary, VM-Off/removal and evidence controls.
Personal-host services/accounts/ACLs, WSL, existing VMs, credentials, user files,
global defaults and provider authentication are excluded.

The host corpus runs before VM creation. The same finite corpus then runs inside
the exact Windows 11 VM through the existing trusted administrator
PowerShell Direct session. Thirteen pinned leaves, including the manifest, are
copied to a new SYSTEM/Administrators-only
`C:\ProgramData\AegisCloudLab\installed-owner-inputs`. Host and guest retain
the exact input handles and compare every size/hash through closure. Guest
diagnostics use new private `C:\AegisLab\installed-owner-temp` and
`C:\AegisLab\installed-owner`; the latter must initially be absent. The same
fixed protected root, fresh account and service are created in the guest and
removed by their exact association before VM teardown. The outer receipt binds
the corpus to the independently observed Windows 11 OS and host-held input pins.

Source, compiler, command, binary and observed resource hashes/identities are
recorded with bounded receipts. Native result/counter filenames include the exact
install ID, epoch and revision and are created once. An earlier receipt cannot
establish a new attempt. The fresh host observation must include actual
owner/DACL data, original owner/operator token SID/LUID/session, exact retained
children and independent fixed inspection counter. The separate mutation actor's
original suspended process token is independently checked for medium integrity,
no elevation, no administrator-capable groups (including deny-only membership),
and only ordinary assigned privileges. The host observes its retained Job census,
root exit and allowed write/delete/overwrite effects before accepting protected
file access-denied results. A static parser/model result
cannot grant a native qualification PASS.

Installation validates every source hash before effects. New protected directories
use exclusive `CreateDirectoryW` with their security descriptor already applied;
an existing directory cannot be adopted after a `Test-Path` race. It stages a complete
protected revision and atomically renames the held staging directory to the fixed
root. Failure before publication deletes only bounded held owned files. Upgrade
first requires the actual retained SCM service to be STOPPED and the original
owner process to have exited, before staging or other upgrade effects. It then
stages completely, rechecks the idle exact service, moves the held prior root to a
rollback sibling, publishes the new root and verifies service/configuration; a
failed publication restores the original root and retained idle SCM configuration. The prior root
is preserved through publication validation. Failure while deleting the old
verified revision is terminal; a partly deleted prior revision is never restored.
An epoch that already completed inspection is one-use: rollback restores its exact
bytes and identity, while a fresh revision/epoch is required for another admission.

Uninstall also requires the original retained SCM service already STOPPED and the
original owner process exited. An active or unknown owner is refused before any
cleanup effect. The complete finite file, receipt and disposable control set is
validated before service deletion; main registration and previously captured
receipt identities stay pinned, and only receipt paths selected before an actual
attempt may be captured. Uninstall deletes only the original held SCM object after exact command,
account and type checks. It then deletes only the retained bounded file/directory
identities and exact SID-associated local account. Any unknown child, changed
association, reparse point, unconfirmed stop or deletion blocks cleanup/PASS and
prevents another install/launch. Receipt identities and hashes are captured in
the bounded qualification report before exact original files are removed. No recursive deletion is
used. Hosted retention is seven days, the existing single receipt is capped at
1 MiB, and the installed-owner subreceipt is capped at 64 KiB.

The exact empty owned parent is deleted last, after the original account SID is
confirmed absent. Failed account removal therefore leaves fresh installation
blocked. Unconfirmed native child/Job closure is terminal even after the owner
service stopped; it cannot authorize resource deletion or another attempt.
Concurrent replacement by an already privileged administrator between directory
creation and the first pinned open remains outside this source slice.

Full reboot, independent recovery observer, exhaustion, actual interactive UI,
guest/provider authentication, complete E1/E11 and A1-A4 remain unqualified.
