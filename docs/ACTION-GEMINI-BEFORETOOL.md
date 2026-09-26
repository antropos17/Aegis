# Opt-in Gemini `BeforeTool` exact deny hook

This adapter evaluates one Gemini CLI `BeforeTool` request for the built-in
`run_shell_command` tool. An exact policy match emits `{"decision":"deny","reason":"AEGIS policy does not allow this tool request."}`
with exit code 0. A valid request without a matching rule emits `{}`: it grants
no AEGIS permission. This is a manual, provider-scoped hook, not an AEGIS
execution barrier.

For general shell restrictions, start with Gemini CLI's
[native policy engine](https://geminicli.com/docs/reference/policy-engine/),
which supports provider-owned `deny` rules and user or admin policy files.
This hook adds a narrow exact match on the complete tool input and selected
working directory within Gemini's hook boundary.

## Select a policy and connect the hook

Create a private regular JSON file outside an agent-editable project if possible.
Schema 1 has exactly these top-level fields:

```json
{
  "schemaVersion": 1,
  "provider": "gemini-cli",
  "hook": "BeforeTool",
  "cwd": "C:\\work\\selected-project",
  "tool": "run_shell_command",
  "deny": [
    {
      "command": "Get-Content -LiteralPath 'C:\\work\\selected-project\\secret.txt'",
      "description": "Read selected file",
      "dir_path": "C:\\work\\selected-project",
      "is_background": false
    }
  ]
}
```

Each `deny` entry is a **complete** `tool_input` object. Include optional
fields only when they appear in the Gemini request. `command` is required;
`description`, `dir_path` and `is_background` are documented optional Gemini
arguments. Every own key and value must match, regardless of object key order.
Additional or missing fields, changed casing or whitespace, and a changed
`cwd` are not normalized. A valid changed tool input returns `{}`; a missing,
relative or mismatched `cwd` returns the fixed deny. The policy has no
`allow`, `ask`, wildcard, prefix or default decision. Unknown policy fields,
empty/duplicate entries, and more than 32 entries invalidate it.

Merge the following entry into your selected Gemini `settings.json` yourself;
preserve any existing hooks. Replace the example paths with real absolute paths.
The matcher is anchored because Gemini matchers are regular expressions.

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "^run_shell_command$",
        "hooks": [
          {
            "type": "command",
            "name": "aegis-gemini-exact-deny",
            "command": "node \"C:/path/to/AEGIS/src/main/main.js\" --gemini-beforetool-hook \"C:/path/to/private-policy.json\"",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

Gemini supplies the JSON request on stdin and reads one JSON object on stdout.
The AEGIS CLI flag starts before Electron and does not start monitoring or a
server. No Gemini installation or configuration is changed by AEGIS. Remove
the hook entry to disconnect it. Confirm that `hooksConfig.enabled` remains
enabled, that this hook is absent from `hooksConfig.disabled`, and that Gemini
loads the settings file. Project hooks can be suppressed by folder trust.

## Scope and failure behavior

The [Gemini hook reference](https://geminicli.com/docs/hooks/reference/)
specifies that `BeforeTool` can block a tool using `decision: "deny"` and a
reason. A valid other event or tool gets `{}`. For malformed/oversized stdin,
invalid in-scope arguments or cwd, an unreadable/changed/invalid selected
policy, or the internal deadline, this adapter attempts the same fixed deny
JSON with exit 0. It never writes the command, arguments, cwd, session data,
policy contents or parser errors to stdout or stderr.

Stdin and policy files are each limited to 64 KiB. JSON parsing is limited to
depth 8 and 2,048 values, and the whole stdin plus policy evaluation shares
a 1.5-second internal deadline. Selected policy reads reject nonregular files,
recognized leaf symlinks/junctions, UNC/device paths and alternate-stream
leaf names. The parent path is canonicalized, and file identity/size/times are
checked around the read. This detects visible changes, not every same-size
rewrite or hostile filesystem race. The policy is read again for every call.

The [Gemini shell reference](https://geminicli.com/docs/tools/shell/) says
Windows shell commands run via `powershell.exe -NoProfile -Command` (and other
platforms via `bash -c`). This adapter compares the JSON command string and
does not parse PowerShell, reapply Claude Bash rules, inspect executable
content or bind the request to OS process identity. It does not evaluate other
tools or a later change to arguments by another hook.

The deny works only when Gemini starts and honors this hook. A disabled,
unloaded, unstartable, timed-out or crashed hook can fail open at the provider
boundary. `ask` is not used as a blocking result. User settings, workspace
trust, other hooks and Gemini's own permissions remain provider-controlled;
the [Gemini configuration reference](https://geminicli.com/docs/reference/configuration/)
documents `hooksConfig.enabled` and `hooksConfig.disabled`. There is no
automatic install, approval, signing, or independent execution mediation.

## Verification status

AEGIS unit and Node CLI tests cover exact/changed arguments, policy changes,
path and file failures, malformed/oversized data, a hung producer, the fixed
private response and startup without Electron. They do not exercise an
installed Gemini CLI. Native Gemini behavior remains unverified.
