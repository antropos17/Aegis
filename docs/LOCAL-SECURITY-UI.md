# Local security workspace

The Observatory **Local security** workspace exposes the existing offline review
capabilities from A1–A4. It is available in the Assess navigation group and command
search. AI analysis remains a separate provider-backed activity assessment.

## Operations

| Review type | Inputs selected in native dialogs | Result |
| --- | --- | --- |
| Security scan | Directory and optional offline MCP tools/list JSON | STA001–STA021 findings, original file hashes/available lines, selected-source flow evidence, MCP description-relative lines and coverage gaps |
| Component inventory | Explicit project/profile directory and optional MCP export | Recognized components, package/lock/Git evidence, tool fingerprints and an unreviewed snapshot |
| Snapshot comparison | Directory, optional MCP export and saved inventory snapshot | Added, changed and removed observations; incomplete observations and incompatible scope remain distinct |
| External report | Directory, selected Cisco JSON/SARIF format and file; optional prior AEGIS static JSON | Fresh built-in review, unverified external claims, source matching and baseline status |

Project and explicit user/managed layouts use the existing profile contracts.
Security scan and external import also support a selected skill/package tree.
Choosing a profile never automatically reads the current user's home directory.
No command, scanner, model or MCP server is started. No network request is made.
Gemini CLI has explicit user, project and Windows system settings layouts. A
project-root selection and a user-home selection also recognize their respective
`.gemini/settings.json` files. Results count declarations in the selected files;
they do not resolve active settings or prove a server connection.
Project-root, user-home and `gemini-user` selections also observe their declared
default `GEMINI.md` instruction candidates. Inventory records byte hashes and
static review checks bounded instruction patterns with semantic coverage gaps.
The workspace does not determine Gemini CLI's effective context, follow imports,
walk context hierarchy or extensions, or infer a custom `context.fileName`.

## Review and persistence

Results retain their original operation, layout, selected directory and capture
time when the form changes. Cancelled or failed runs preserve the previous result.
Findings, files, packages, tool fingerprints, changes and coverage use searchable,
paginated lists with expandable evidence. All retained rows remain reachable.
No findings, collected scope and unchanged content are never called safe.

**Export JSON** saves the main-owned redacted report in its original contract.
**Save unreviewed snapshot** records the captured inventory without accepting it.
**Recheck and save accepted copy** requires explicit review acknowledgment, the
displayed digest and a fresh complete matching capture. Changed or incomplete
content fails acceptance. Acceptance records a local decision; it does not verify
a publisher, an installation or future behavior. Artifacts use new filenames
outside the reviewed directory. Existing files are not overwritten.

The workspace retains one result in memory. It does not automatically persist a
history or baseline, and loading a snapshot never silently accepts new bytes.
Preview results are simulated and cannot write files or accept content.

## Compare a returned result

Local security compares a result bundle that holds a “before” snapshot, an
“after” snapshot and some claims. **Choose result and compare**, in the
**Imported result comparison** panel, opens a file dialog to select the bundle,
and **Compare a returned result**, in the **Start with a project folder** panel,
jumps to that button. Importing a bundle does not run code from it or write
anything to the project.

Once imported, the **Changes** list shows each file that differs between the two
snapshots, with up to 20 changes per page. Files selected in the list serve only
as a reader’s note: the selection stays in the window and does not mark the
bundle as reviewed or approved. **Find a changed file** searches the list, and
**Change type** filters the list to additions, edits, deletions or unknown
changes. In an invented example, a bundle holds a “before” snapshot with
`notes.txt` and `old.txt`, and an “after” snapshot with a changed `notes.txt`
and a new `todo.txt`. The **Changes** then lists `notes.txt` as an Edit,
`old.txt` as a Deletion and `todo.txt` as an Addition.

The **Coverage** section shows the capture source, original-state confidence,
retained status and writer status. It also holds two buttons that appear once a
result is loaded. **Refresh retained comparison** retrieves the saved comparison
again and does not reread the original files. **Clear retained comparison**
removes the saved comparison from AEGIS and from the panel, and does not change
or delete the imported file or the project. Clearing releases the copy AEGIS
holds but does not guarantee that the data is securely erased from memory. Both
buttons are disabled in the simulated preview.

A result file can claim that it was accepted, that the program which made the
changes was stopped, or that a safety boundary held. AEGIS treats all three as
untrusted and gives them no authority. The **Writer status**, which refers to
the program that made the changes, shows “Stop unconfirmed”, and the section
states that AEGIS observed no program stop and no protected boundary. Both
**Launch unavailable** and **Project export unavailable** remain disabled
because launching and exporting need protection and a check against the current
original files, which the comparison does not provide.

If either snapshot is marked incomplete, the **Changes** list shows each
differing file as an “Unknown change”, because AEGIS cannot tell whether the
file was added, edited or deleted. A missing file or an empty list does not mean
a file was deleted, and it does not mean nothing changed. If the “after”
snapshot in the earlier example were marked incomplete, `notes.txt`, `old.txt`
and `todo.txt` would all be labelled as “Unknown change”, and the absence of
`old.txt` would not show that it was deleted. Even when both snapshots are
complete, the comparison remains unverified against the current original files.
In that case, **Original-state confidence** reads “Complete imported snapshots ·
originals unverified”.

Unlike [Snapshot comparison](INVENTORY-SNAPSHOTS.md), which checks a selected
folder against a saved inventory snapshot, and [External
report](STATIC-REPORT-IMPORT.md), which matches another tool’s findings against
a fresh review of the folder, the returned result comparison reads only what is
inside the bundle. For the bundle rules and boundaries, see [Imported result
comparison](roadmap/enforcement-e9/result-review.md).

## Boundary and limitations

The `local-security:review` invoke accepts a bounded operation and built-in options.
It accepts no renderer-supplied path, command, URL, report body or output bytes.
Main opens the native dialogs, binds the result to a generated identifier, checks
the owned top-level frame and exact configured renderer document, serializes
operations and invalidates results when that document navigates.

Writers recheck caller validity and canonical path/inode identity before writing
and before completion; failure cleanup removes only the same newly created closed
file. Filesystem checks remain best-effort against concurrent host filesystem
mutation, not an OS sandbox. JSON reports have an 8 MiB export bound; snapshot and
import readers retain their existing stricter limits.

Static review retains English-pattern and semantic-coverage limitations. External
claims remain unverified. Unsupported syntax, pagination, missing observations,
profile/version uncertainty and byte changes stay visible. Runtime prevention and
the planned A5 behavioral-chain changes are outside this workspace integration.
