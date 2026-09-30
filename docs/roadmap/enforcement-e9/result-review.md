# Imported result comparison and disposable publication

The existing Observatory Local Security workspace can select one imported result
bundle through the main-owned native dialog. The existing `local-security:review`
channel adds only exact `review-result` and `result-status` operations. The renderer
supplies options or a retained opaque ID; it cannot supply filenames, payload,
acceptance, destinations or project-write requests. Existing window, top-frame,
document and revision guards apply before selection and after every asynchronous
read boundary. Navigation or destruction invalidates the retained ID.

Main retains copied snapshots under that ID and returns bounded comparison metadata.
Cancellation and failure preserve the prior comparison and local selection draft.
Workspace navigation retains the panel, while destruction ignores pending replies.
Captured state does not establish Protected status. Imported acceptance, writer-stop
and boundary success claims have no authority; writer status stays stop-unconfirmed,
and launch and project export remain unavailable.

## Bundle and comparison contract

`result-review-bundle.js` admits exact schema 1 JSON with `captureSource: external-result`,
`before` and `after` snapshots, and a `claims` object containing three boolean fields:
`accepted`, `stopped`, `boundaryPassed`. Each snapshot has `complete` and `files`;
each file has a relative `path`, `kind: file`, and canonical `contentBase64`.
The existing strict inventory JSON parser rejects duplicate decoded keys, comments,
invalid encoding and excessive parse depth. Unknown domain fields are rejected.

Limits are 128 distinct paths across both snapshots, depth eight, 64 KiB per
entry, 1 MiB total decoded bytes across both snapshots, and 2 MiB input JSON.
Absolute/UNC/device, traversal, ADS, reserved, control/formatting, duplicate,
case-colliding, file-ancestor and link paths are refused. Deterministically sorted
manifests hash private owned copies. Complete before/after populations derive
additions, edits and deletions. If either snapshot is incomplete, changed rows
remain unknown; absence and an empty list never imply deletion or equality.
Imported complete snapshots remain unverified against current original files.

Read-only per-entry before/after previews derive only from those private copies.
Each displayed text preview is at most 2 KiB; aggregate text is at most 32 KiB;
comparison metadata is at most 256 KiB. Full byte counts and hashes remain available
in a compact disclosure. Missing, incomplete, binary and truncated previews are
distinct. Terminal/directional formatting controls become visible U+ labels; Svelte
renders the text with ordinary escaping. Previews may contain user-selected file
content and are never included in the metadata-only qualification CLI report.

## Developer plan and executable evidence

`result-review-plan.js` accepts only an actual process-private parsed review and an
explicit trusted owner `{reviewId, revision}`. This trusted creation boundary is
not an imported claim or renderer operation. Exact change IDs and baseline,
snapshot and selection digests bind the developer plan. A selected deletion needs
explicit acknowledgment. Every attempted preparation consumes the private plan
before owner and current-original comparison. Conflict or stale revision requires
fresh acceptance, even if original bytes are subsequently restored. Serialized
plans, substituted handles and changed buffers cannot reuse private authority.

`prepareResultReviewPublication` copies one self-contained selected-change bundle;
it performs no filesystem writes. The fixed CLI qualification owner supplies
immediately reread disposable original bytes. It does not capture or apply an
arbitrary project, stop a writer or authorize a production export.

Run `node scripts/qualification/qualify-result-review.mjs` for eleven actual local
cases: selected changes with omitted files absent, acknowledged deletion, stale
revision, original conflict/no retry, swapped input/copy buffers, traversal, link,
case collision, existing destination, interrupted publication and dishonest claims.
Generated originals and destinations stay inside the exact disposable fixture.
Publication writes and syncs one stage, verifies its actual bytes, and creates an
exclusive same-directory hard link so an existing final artifact is preserved.
Independent readback checks selected bytes and unchanged originals. No hooks,
Git filters, package scripts, imported commands or external services execute.

The desktop real-preload harness selects only generated fixtures and checks preview
escaping, retained bytes after artifact replacement, and reload/document denial.
The preview harness exercises the shared active component with explicit simulated
data, four themes, larger text, English/Portuguese, keyboard tabs and retained results.
Their screenshots and source-matched receipts are stored under the task's X: run
directory. Production and preview are built independently; production excludes demo
fixtures. Configured typecheck does not check main JS bodies (`checkJs=false`).

Arbitrary-project capture, hostile filesystem swaps, held-handle destination writes,
actual writer termination, guest return-channel authenticity, process-isolated
storage, durable approval/restart authority and power-loss recovery remain
unqualified. Draft #703's native sealed import is absent on this branch. Generic
inventory acceptance and report export remain separate from project-result writes.
