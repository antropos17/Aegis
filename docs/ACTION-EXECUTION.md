# Explicit policy-controlled direct execution (B1)

`--action-exec-json <policy.json> <request.json>` is an opt-in execution owner:
AEGIS reads both selected files, evaluates an exact operation and starts its own
direct child only on allow. Deny, ask, invalid input, unavailable policy and
preparation timeout never authorize a launch. This closes the launch-decision
failure path for this explicit CLI route. The [selected-action MCP adapter](ACTION-MCP.md) connects an explicitly configured
agent tool to this owner. Agents launched normally, provider hooks and commands
outside these routes receive no such protection.

This is not a sandbox. An allowed executable runs with the caller's account and
can read files, use the network, spawn descendants or change the system. AEGIS
does not interpret argument semantics. Use only a deliberately reviewed command.
No provider configuration or installed application is changed automatically.

## Files and invocation

The request uses schema 1 and exactly `schemaVersion` and `action`. An action has
exactly `executable`, `cwd`, `args` and `env`. For example, adjust these explicit
Windows paths to the selected installation and directory:

```json
{
  "schemaVersion": 1,
  "action": {
    "executable": "C:\\Program Files\\nodejs\\node.exe",
    "cwd": "C:\\work\\selected-project",
    "args": ["-e", "process.exit(0)"],
    "env": { "SYSTEMROOT": "C:\\Windows", "WINDIR": "C:\\Windows" }
  }
}
```

The policy uses schema 2 and exactly `schemaVersion`, `defaultDecision` and
`rules`. Defaults are deny or ask. Each rule has exactly `action` and `decision`,
where action is the complete action object above and decision is allow, ask or
deny. An example policy without any permitted operation is:

```json
{ "schemaVersion": 2, "defaultDecision": "deny", "rules": [] }
```

To permit the example, insert its exact action into a rule with decision allow.
There is no prefix matching, wildcard, shell parsing or automatic approval.
Changed executable, cwd, any argument or environment field fails to match.
Object key order is ignored; argument order, types and additional fields matter.
Equivalent duplicate rules invalidate the policy. Existing schema 1 Bash hook
policies are incompatible with this distinct execution surface.

```sh
node src/main/main.js --action-exec-json /absolute/policy.json /absolute/request.json
```

Paths inside the action must be absolute; Windows paths must include a drive and
root. UNC/device paths and Windows alternate-stream paths are unsupported.
No NUL is allowed in action fields. There are at most 128 arguments, 64 environment
entries and 32 exact policy entries. Selected files share the existing 64 KiB
read, UTF-8, JSON depth/node and regular-file validation from the policy hook.
Recognized leaf links are rejected; filesystem race and reparse limitations remain.

## Environment and runtime

Only uppercase environment names with letters, digits and underscores are
accepted, beginning with a letter or underscore. Values are explicit strings.
The child environment starts with deterministic empty defaults and the approved
map overrides them. It never starts as a copy of the parent environment.

On Windows, empty defaults cover `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `PATH`,
`SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `USERDOMAIN`, `USERNAME`, `USERPROFILE` and
`WINDIR`. These prevent libuv from silently filling missing names from the parent.
Set the variables the selected application actually requires in both request
and policy. In particular, the tested Windows Node executable requires an
explicit Windows system directory; an empty environment can make a child fail.
Choose explicit spacious TEMP/TMP paths for commands that produce temporary data.
On every platform `NODE_V8_COVERAGE` is explicitly empty; a nonempty requested
value is rejected to prevent automatic child coverage-file persistence.

These defaults address the native inheritance behavior in
[Node 24.11.1](https://github.com/nodejs/node/blob/v24.11.1/lib/child_process.js)
and [libuv's Windows process implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c).
The runner rejects a parent with active `child_process` debug logging or Node's
permission model, whose runtime behavior changes logging/environment propagation.
Supported runtime platforms are Windows, Linux and macOS; this is not evidence
of installed-runtime verification on every platform or future Node version.

The runner uses direct spawn with `shell: false`, hidden windows and ignored
stdin. Shell metacharacters in arguments remain arguments. Explicitly selecting
a shell/interpreter still gives that executable its normal capabilities.
Executable bytes, libraries, scripts, symlink targets and cwd contents are not
pinned; a matching path is not content identity. A same-user process may alter
the selected policy or executable. The launch descriptors remain private memory.
The operating system can expose child command lines; crash dumps and files written
by the allowed program are outside this report-privacy boundary.

## Deadlines, output and report

Preparation has a combined 1.5-second deadline. A late allow never starts a child.
Once launched, the direct child has a five-second runtime limit and a combined
64 KiB stdout/stderr accounting limit. Raw output is discarded as it arrives;
the report exposes only capped byte counts and completeness. A bound violation
requests force termination of that child and permits one second for confirmation.
An exit event confirms the direct child's exit; a successful kill request alone
does not. An unconfirmed termination is explicitly reported. Descendants may
continue running and holding files or pipes; no process-tree control is claimed.
Event-loop stalls and synchronous native spawn cannot be preempted by JS timers.

The single schema 1 report pairs decision and direct-child state in the same
invocation. It contains fixed reasons, exit code, termination evidence and output
completeness, never input paths, arguments, environment values, child output or
exception messages. Exit 0 requires an allowed child with observed exit code 0
and complete output accounting. Invalid CLI arguments exit 1; all other failures,
ask, deny, interruptions or incomplete results exit 2. An unexpected outer error
reports unknown execution state rather than asserting nothing ran.

Permission is evaluated anew per invocation; there is no approval prompt,
single-use approval token or replay ledger. Ask remains not-started. The direct
result is distinct from provider-reported after events in the session API.
Neither mechanism proves that all agent activity flowed through AEGIS. B1 still
needs broader deliberate agent routing and approval binding; protected process trees,
filesystem/network isolation and tamper resistance remain later roadmap work.


## Verification

Focused tests include exact policy matching, malformed files and schema fields,
ask/deny/unavailable policy without launch, delayed evaluator completion,
termination errors, output privacy, explicit environment behavior and CLI routing.
Native Node fixtures on Windows verified allow-only sentinel creation, literal
shell metacharacters, runtime and output-limit termination with an observed exit.
The CLI is not an installed Claude/Codex routing integration; no external agent
was configured to send its commands through this runner. Linux CI verifies the
same native fixtures; macOS has not been exercised locally.

The owning MCP adapter may pass an AbortSignal to the execution API. Cancellation
during preparation denies without launch; cancellation after launch requests
direct-child termination with the same bounded confirmation semantics.
