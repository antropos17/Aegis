# Selected file deletion (B4)

`--action-delete-file-confirm <policy.json> <request.json>` is an opt-in,
terminal-owned operation. AEGIS itself removes one existing regular file after
an exact policy match and a fresh `DELETE <challenge>` answer. On Windows it
starts only the private native helper; it does not launch a requested executable
or provider tool. This standalone command is separate from the schema 2/3 execution
policy.

## Selected-file MCP terminal route

An operator can expose the same deletion through a dedicated MCP tool by starting
a terminal broker with fixed policy, request and new endpoint paths:

```sh
node src/main/main.js --action-mcp-delete-review /absolute/policy.json /absolute/request.json /private/newendpoint.json
```

On Windows, the installed application also provides an explicit native owner
console launcher at `resources/sidecar/aegis-owner-console.exe` under the
installation directory. Start that executable from a console and pass the same
`--action-mcp-delete-review` arguments. Its original standard input and standard
error must both be console handles; redirected or missing handles are refused.
The launcher runs one review attempt per session, so start a new session for a
further attempt. The response is not echoed. The optional `--observe` argument
works as on the source route.

To choose explicit profile paths, place `--profile-root <absolute-directory>`
before the review flag. The root must be on a local fixed NTFS volume and must
already contain directories named
`appdata`, `localappdata`, `userprofile`, `home`, and `temp`. Each directory must
already contain a regular, non-link file named `.aegis-owner-profile-anchor`,
owned by the current account and with exactly one hard link.
The launcher retains these file and directory identities without reading anchor
contents, refuses links and junctions, and shows the selected root and mappings
in the review. The handles remain held through
confirmed Job cleanup; if cleanup cannot be confirmed, the launcher fails and
cannot guarantee custody for any process still alive. Invalid selections are
refused; the launcher does not substitute the account profile. This selects environment paths
for the launched route and delete helper; it is not a filesystem sandbox and does
not prevent Windows known-folder APIs or same-account code from accessing other
locations. Without `--profile-root`, the launcher does not claim profile isolation.
Retained ancestor handles deny renaming and can prevent exclusive opens until the
session closes; ordinary shared writes to those ancestors remain available.

For example, with those five directories and anchor files already created under a
private scratch root, start the launcher from PowerShell using your actual
installation and paths:

```powershell
& 'C:\path\to\AEGIS\resources\sidecar\aegis-owner-console.exe' --profile-root 'X:\private\profile-root' --action-mcp-delete-review 'X:\private\policy.json' 'X:\private\request.json' 'X:\private\newendpoint.json'
```

The launcher itself is a .NET Framework executable: its runtime initializes before
the launcher can construct the restricted child environment. Start it from a
trusted environment; inherited CLR profiling or runtime settings can affect that
initialization.

The launcher checks the original handles before starting the packaged app and
uses a bounded, authenticated local channel to a supervised console worker. A
console response is not human authentication: a local process may automate a
console, and a completed console write does not prove a person saw the preview.
Console input does not establish physical key timing. Same-account injection,
handle duplication and modification of installed binaries are outside this
boundary. An abrupt shutdown may prevent a final report, and cancellation after
the native delete begins cannot undo an already completed deletion.

Configure the intended client to use the existing
[review relay](ACTION-MCP-REVIEW.md) with
`--action-mcp-connect /private/newendpoint.json`. The
[configuration generator](ACTION-MCP-CONFIG.md) can produce that relay entry
with `--action-mcp-config-json relay /private/newendpoint.json`; it does not
start the broker or install settings. The broker requires a live terminal and
accepts one bearer-authenticated relay connection. Its endpoint file belongs in
an operator-private directory.

This route publishes `aegis_delete_selected_file` with an empty object argument
schema and the read-only `aegis_route_status` tool. Client-supplied paths, extra
fields or malformed arguments are rejected before review. Initialization binds
the exact selected policy and request bytes; each accepted call uses that same
private binding and requires a fresh terminal challenge. An observed change or
read failure revokes the connection binding; restoring bytes afterward does not
revive it. An affirmative answer permits the existing deletion executor to
recheck the target and attempt one selected-file deletion. A second call needs its own
review. The MCP result contains the redacted `action-delete-file` report;
`isError: false` requires
`operation.state: "deleted"`. Cancellation, transport closure and owner shutdown
abort pending review; a completed deletion cannot be undone.
The selection is checked on calls and after review; there is no continuous
filesystem watcher.

The connection-local `aegis_route_status` result uses `selected-file-only` for
this route and reports attempts and owner outcomes. Add
`--observe <new-observation.json>` after the broker endpoint to publish a separate,
read-only desktop observation endpoint. **Action control → Live route observation**
labels its selection as file deletion and shows operation attempts and owner
settlements. Its snapshots contain no selected path, contents or bearer. A settled
call does not by itself prove deletion; inspect the returned deletion report for its
operation state. These counters do not prove blocking outside this selected route.

The request and policy are bounded JSON files selected by the operator:

```json
{ "schemaVersion": 1, "operation": { "kind": "delete-file", "path": "C:\\work\\project\\old.txt" } }
```

```json
{
  "schemaVersion": 1,
  "defaultDecision": "deny",
  "rules": [
    { "operation": { "kind": "delete-file", "path": "C:\\work\\project\\old.txt" }, "decision": "allow" }
  ]
}
```

All fields are closed. The rule must name the identical path; no prefix, glob,
command string or directory recursion is accepted. `allow` still requires the
terminal challenge. `deny`, an absent rule, missing terminal, refusal, timeout,
and an input failure or cancellation observed before mutation admission prevent
the deletion. A console or transport loss can still be in flight when the native
commit begins. The pre-commit health check is a point-in-time observation, not
an atomic barrier against a concurrent loss. The
selected policy and request are captured as private byte bindings and checked
again after confirmation. The target must be an ordinary file with directory
parents that are not links or junctions. Its filesystem identity, size and
change timestamps are checked before and after confirmation. The policy and
request files cannot themselves be the target.

On Windows the operation requires the ordinary packaged `hook-review` native
assets (or prepared assets under `build/hook-review` for the documented Node source
command). The operator must keep the helper assets and their load directories
trusted and stable through launch and execution; the asset manifest is not an
independent signature. See [the native IO prerequisites](CLAUDE-HOOK-WINDOWS-IO.md).
The helper accepts a restricted absolute local NTFS path, rejects reparse points,
multiple hardlinks and unsupported attributes, and pins the original file and
its ancestors through review. It prevents incompatible concurrent opens and
marks that same handle for deletion only after the second configuration and
target checks. Unsupported paths, unavailable assets and conflicting handles
are refused. The target must also be distinct by file identity from both control
files. Other platforms retain the existing pathname-based unlink.

The command emits a fixed-metadata `action-delete-file` report without the file
path or contents. Exit 0 requires native confirmation that the Windows target is
absent after disposition and handle closure, or a successful unlink elsewhere;
exit 1 means invalid command arguments; other outcomes exit 2. A pending deletion,
interrupted native request or uncertain cleanup is `unknown`; a previously open
reader can delay deletion after it has been marked. There is no retry and no
recursive removal.

This control applies only to a request explicitly sent through the standalone
command or the selected-file MCP terminal route.
The target is an exact absolute path and may be outside a project if the
operator explicitly permits it. Other agent tools, ordinary shell commands and
allowed child processes can still delete files. The process uses the caller's
account. A same-account actor can change policy or filesystem paths. On non-Windows
platforms, a swap between the final path check and unlink remains possible.
Windows handle custody is limited to the selected local NTFS file and does not
protect against privileged or raw-volume modification, pre-existing writable
mappings, outside-route operations or control-file changes after the final check. No protected launch, separate account, process-tree containment or
outside-route coverage is established. C1 is required before extending a
destructive-operation guarantee to arbitrary allowed children.

Focused tests cover real local file removal, policy denial, missing rule and
terminal, refused review, selected-file mutation, target changes, links and
junctions, invalid schema/path and cancellation. Windows native owned fixtures
cover original-handle deletion, replacement refusal and pending-reader uncertainty. The MCP route tests also cover
argument rejection, request-ID replay, terminal timeout, and a separate process
deleting an outside-route sentinel. These fixtures do not establish control of
third-party agent routes or resistance to same-account races.

## Installed Claude Code compatibility fixture

On Windows, an operator can run the opt-in installed-provider check with a live
terminal and a spacious existing scratch directory:

```sh
node scripts/verify-claude-action-mcp.mjs --delete-review --claude <absolute-claude.exe> --bash <absolute-Git-bash.exe> --scratch <existing-private-directory>
```

The fixture creates its own isolated `CLAUDE_CONFIG_DIR`, dummy API key, loopback
synthetic `/v1/messages` endpoint, selected policy/request files, and MCP relay.
It asks for the displayed `DELETE <challenge>` in the approved case, `no` in the
refused case, and no input for policy denial. Each case uses an owned scratch
target; a neighboring scratch file must remain intact. The oracle requires
Claude to discover `aegis_delete_selected_file`, receive a matching `tool_result`
with an `action-delete-file` JSON report, and observe the matching filesystem
state. A final stdout receipt contains only redacted fixed fields. The private
terminal preview can contain the selected path, so do not save a terminal
transcript as the receipt.

On 2026-09-26, this check passed with installed Claude Code 2.1.263: all three
cases passed, six synthetic loopback API requests were observed, no proxy
requests were rejected, and the broker endpoints and owned scratch were removed.
The two prompted cases showed distinct fresh challenges. This evidence covers
the installed provider route exercised here; the fixture does not prove
cloud-model behavior, provider identity, all-network isolation, human presence,
or deletion attempts through other tools.
