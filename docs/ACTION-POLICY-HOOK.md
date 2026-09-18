# Experimental exact-input Bash policy hook (B1)

Status: a connected **before-only** Claude command-hook adapter. It returns
`allow`, `ask` or `deny` for `PreToolUse` Bash requests. B1 remains partial:
a separate [in-process session](ACTION-POLICY-SESSION.md) now correlates decisions
with after reports in the provider fixture. Production linkage, reusable permission
protection, exact approval binding and failure-resistant execution mediation remain open.
This adapter does not reuse the lifecycle collector or send arguments over HTTP.

## Explicit configuration

Create a private policy JSON file outside the agent-editable project when possible.
Its path is explicitly selected; AEGIS performs no configuration discovery or
installation. Schema 1 requires exactly these fields:

```json
{
  "schemaVersion": 1,
  "cwd": "C:\\work\\selected-project",
  "defaultDecision": "deny",
  "rules": [
    {
      "tool": "Bash",
      "input": { "command": "git status --short", "description": "Show working tree status" },
      "decision": "ask"
    }
  ]
}
```

`cwd` must match the provider's absolute string exactly. Every own field of the
complete `tool_input` must match a rule's `input`, including description, timeout
and any other options. Object key order is irrelevant; array order, types and
additional fields matter. No wildcard, prefix, substring, path normalization or
shell analysis is performed. Each rule supports `Bash` only. Repeated/conflicting
exact rules, unknown policy fields and unknown decisions invalidate the policy.
Defaults may be `deny` or `ask`; a default `allow` is rejected. Unrecognized tools,
phases, missing identifiers and cwd mismatches always deny, even with default ask.

Add a command hook to the selected Claude configuration only when choosing to
enable it. Preserve existing settings and use actual absolute paths:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node \"/absolute/AEGIS/src/main/main.js\" --action-policy-hook \"/absolute/private-policy.json\"",
        "timeout": 5
      }]
    }]
  }
}
```

Use a synchronous command hook with provider timeout greater than the internal
1.5-second deadline. A matcher for Bash means other tools are outside this gate;
if routed here anyway, they are denied. The implementation does not modify hooks,
permissions, policy files or the installed application. Remove the hook entry to
disable it. The evaluator never executes commands or opens command target files.

## Decisions and failures

The CLI reads one bounded JSON request from stdin and returns only the official
`hookSpecificOutput` object with `PreToolUse`, `permissionDecision` and a fixed
generic reason. It emits no command, path, session/tool-use ID, input hash, exception
message or provider output. Neither source IDs nor producer-supplied verification
fields can override policy. No payload or permission history is persisted.

| Result | Meaning |
| --- | --- |
| allow | The current parsed input matched an explicit allow rule in the selected read |
| ask | Approval is delegated to the provider; AEGIS has not observed or granted approval |
| deny | No permission from this hook; a valid deny response exits 0 with explicit deny |
| Input/adapter failure | Fixed deny and exit 2; at most one response, even after a late evaluator result |
| Policy read/schema failure | Fixed deny; never reuse an earlier allow or fallback to another file |

An internal deadline covers stdin and evaluation together. The CLI drains its
small response then exits, including when a filesystem operation finishes late.
This timer cannot interrupt an event-loop stall or make an unstarted process run.

According to the [Claude hook reference](https://code.claude.com/docs/en/hooks#pretooluse-decision-control),
an allow can bypass the normal permission prompt, while ask delegates to it.
The [timeout contract](https://code.claude.com/docs/en/hooks#timeouts) allows a tool
to continue after a command-hook timeout. Missing/unstartable hooks also leave
provider failure paths. These constraints prevent a general fail-closed or
blocking-verified claim for this surface. The observed deny fixture below is a
specific successful interception, not protection against all failure/bypass cases.

## Trust, privacy and bounds

The policy is trusted local configuration, not a protected policy service. A
same-user process may change it or replace the hook. Reads reject nonregular files,
recognized leaf symlinks/junctions, UNC/device paths and alternate-stream leaf names.
The selected parent is canonicalized; device/inode/size/mtime/ctime are compared
before opening and after reading. This detects visible changes, not every same-size
rewrite, reparse provider or hostile filesystem race. No signature is verified.

Policy and stdin each have a 64 KiB limit. Parsed JSON is bounded to depth 8 and
2,048 value nodes; policy allows at most 32 exact-match entries. Nonfinite parsed numbers,
invalid UTF-8 and lone surrogates deny. Equality preserves keys such as `__proto__`
without constructing prototype-bearing normalized objects. The policy is read
anew on each invocation and remains in memory only for that evaluation. Source
and policy contents may contain secrets, so no unkeyed argument or policy digest
is published. Node memory/crash-dump protection is not claimed.

Exact input matching does not bind executable bytes, script contents, environment,
PATH resolution, Git hooks, symlink targets or network recipients produced by a
command. The provider supplies cwd, session and tool-use identity; there is no
independent OS binding. Other hooks may change input after this observation.
This implementation has no source epoch ledger, expiry token, single-use approval
or cross-invocation replay protection. Repeating an allowed input reevaluates the
same rule. A reported `PostToolUse` cannot prove approval or successful prevention;
after events are unsupported by this adapter.

## Verification

Synthetic unit/CLI tests cover exact matches and changed fields, default ask,
unsupported surfaces, malformed/private data, bounds, file changes and close errors,
slow/failed input, deadline sharing, late allow suppression and provider JSON output.
The CLI initializes before Electron and does not start monitoring/scoring.

On Windows, installed Claude Code **2.1.263** was also run with an isolated config,
working directory and environment, dummy credentials, disabled nonessential
traffic, and a loopback API stub supplying fixed model responses. Actual AEGIS
allow and a no-hook baseline created a harmless disposable sentinel with native
Bash permission; actual deny prevented the identical command and its post-tool
callback. An unstartable hook allowed execution, confirming the launch-failure bypass. A real Claude subagent generated both lifecycle hooks, which
the AEGIS sender/collector accepted. No user configuration was modified. This tests
the actual provider executable and adapters with synthetic model responses;
an OS firewall isolation boundary was not installed.

The opt-in `scripts/verify-claude-hooks.mjs` records version, fixed outcomes and
counts without raw prompts/output. See its `--help` for explicit executable and
scratch paths. It is not part of ordinary CI and does not use an external model.
Interactive ask/approval binding, other provider-hook failure modes, macOS and a
real cloud model session are not verified by that fixture. Linux CI verifies AEGIS
unit/CLI behavior independently of an installed Claude executable.

Next: a production consumer for the session API and an AEGIS-owned execution or
SDK mediation point with verified failure behavior. The [B1 contract](AGENT-EVENT-CONTRACT.md)
and ACS assessment still require those pieces before B1 can be marked complete.
