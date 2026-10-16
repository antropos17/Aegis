# Protected guest hosted evidence — 16 October 2026

This records the bounded administrative path merged in
[PR #942](https://github.com/antropos17/Aegis/pull/942). It is qualification of the
specified source and fixture, with a current-Codex self-review. Independent
acceptance, ordinary installed-caller launch and production admission remain open.

## Source and integration

Tested source: `5113e3b5d8473d105776e92d4830d6824d3f4c5d`.
Merge: `6001f2c295e42392967a845760c8fce14461b35a`.
Base: `ef8f249769902981fe45048b971615c07b113ffb`.
The merge has the base and tested source as parents, and the source/merge Git tree
is identical: `4a4d1f9a2bd8e9f020f88602fee683faa10e8a77`.
Receipts retain the tested source SHA; they are not relabeled to the merge.

| Check | Result | Scope |
| --- | --- | --- |
| [Required CI](https://github.com/antropos17/Aegis/actions/runs/38847005614) | PASS | build, lint, svelte-check, test and audit on the tested source |
| [Native Hyper-V corpus](https://github.com/antropos17/Aegis/actions/runs/38847001856) | PASS | Actual private VM/image creation, disk hydration, bounded firmware lifecycle, upgrade/rollback and uninstall |
| [Windows guest/agent corpus](https://github.com/antropos17/Aegis/actions/runs/38847307744) | PASS | Actual installed Windows guest, administrative protected start, ordinary-user agent and verified closure/removal |
| Local Windows controls | 64 passing tests across three files | Guest transaction, VM/storage and protected installation controls; synthetic provider seams plus real file/token/compile controls |

The local files were `tests/main/protected-guest.test.js`,
`tests/main/protected-vm.test.js` and `tests/main/protected-installation.test.js`.
The final functional inputs passed before the source was frozen. No privileged
VM/account/service/quota experiment was run on the user's workstation.

## Receipt integrity

| Raw JSON receipt | Bytes | SHA-256 |
| --- | ---: | --- |
| `cloud-hyperv.json` | 40426 | `283773aa12a400e31986d2a9b1da730de55de46a5f0ae02c7ab875c92499ec4f` |
| `cloud-windows11.json` | 914833 | `1a57cc9ff55c12b34d0cafb8d2e2f73f069eccc2c5a4996037701ab7215e5ba0` |

Reconciliation matched 67 native and 237 full-guest source/payload bindings to the
tested tree, allowing the recorded LF/CRLF source forms, and checked five compiled
outputs in each corpus. The full corpus's external `git-runtime.zip` has SHA-256
`da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be`;
it is not represented as repository source.

Raw receipts were downloaded and retained during integration. GitHub Actions
artifacts have finite retention; this text preserves the hashes and run links,
not the raw files or a permanent artifact-hosting guarantee. GitHub run metadata
was rechecked during this documentation refresh: all three runs report success
and the tested source above.

## Actual observations

The full Windows corpus first confirmed removal of its earlier fixture VM,
prepared a private offline copy of the installed Windows disk, and exercised a
fresh protected installation. It observed the original private disk identity
through hydration, native Running admission, a standard guest token and agent
exit code zero. The fixture checked argument preservation, denial of private
parent/image writes, successful bounded working writes followed by an enforced
536870912-byte allocation-quota refusal, and descendant cleanup through the Job.
It then confirmed native Off, the original disk FileID and owned VM removal.

The native corpus's inert-media firmware lifecycle is a separate observation;
it does not establish an OS boot or agent run. The full corpus supplies those
actual Windows/agent observations. Neither corpus measures arbitrary providers,
images, workloads or long-running sessions.

## Corrected transition assumptions

Earlier failed runs remain failures. A later bounded native probe observed that
fresh Hyper-V cmdlet results could lag the retained native Running state by about
3.1–3.45 seconds. The implemented admission waits for native/cmdlet agreement in a
five-second polling window plus provider-call time, issues no duplicate provider
transition and immediately refuses native state loss.

Windows also adds a `vmWorkerProcess` capability ACE to runtime VM configuration
leaves. The validator derives the exact capability using the Windows API and
recognizes only finite file rights on original-GUID `.vmcx`, `.vmgs` and `.vmrs`
leaves under the private Machine tree. It does not widen ACLs or accept arbitrary
capabilities, media, directories or foreign VM identities. The
[administrative contract](protected-guest-start.md) documents both changes.

The fixed Claude scratch observer is a separate sampled filesystem check with
16 MiB/256-entry/depth-eight limits. Its one immediate complete retry after a
disappearing child is documented [here](claude-scratch-observation.md); it is not
the guest account's enforced 512 MiB NTFS allocation quota.

## Acceptance boundary

The APIs require an administrator, a trusted offline Windows image, native
sources/helpers and administrative PowerShell Direct. No ordinary desktop
dispatcher launch, authenticated provider runtime, general result review or
recovery/restart of retained unknown VMMS work is supplied by this evidence.
The base image, administrators and privileged guest services remain trust inputs.

At integration, the enforcement tracker retained 30/60 accepted tasks, A1–A4
`UNREVIEWED` and `launchAllowed=false`. Those enforcement acceptance labels are
distinct from the inventory/static-review A1–A4 plan labels. Neither a green lab
run nor documentation publication advances them.
