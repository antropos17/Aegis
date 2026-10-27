# Separate Codex Bash hook profile

AEGIS provides an opt-in, application-owned Codex hook profile on packaged Windows.
The profile is a separate `codex-hook-profile/hooks.json` under AEGIS application
data. It does not edit the owner's Codex home, project `.codex/config.toml`,
managed configuration, model, permission mode or hook trust. The profile is not
directly discovered by Codex as an extra configuration layer: AEGIS validates its
fixed entry and derives a one-session `--config hooks.PreToolUse=...` override.

## Owner workflow

1. In the AEGIS action controls, choose an existing valid AEGIS Bash policy. The
   native installation review shows the selected policy, the target, complete
   changed fragments, exact hook command and decoded command script. The dialog
   defaults to Cancel. AEGIS checks the selected policy and profile again, retains
   and verifies a private backup, then writes and reads back the fixed profile. A
   changed target, unsupported path or uncertain native result is refused or
   retained for review. Creating an empty app-owned draft and backup directory may
   occur before confirmation; cancelling does not install the hook.
2. Select **Review Codex terminal command**. Reselect the policy and explicitly
   choose the native `codex.exe`. AEGIS reviews their identities, the profile,
   exact policy and hook command in a Cancel-default native dialog. A second
   Cancel-default dialog displays the terminal command and its decoded script
   before copying it. The copied command contains an encoded private binding with
   selected paths and hashes; treat it as private and do not share it.
3. From Windows PowerShell in the exact working directory recorded by the policy,
   run the copied command. Immediately before starting the selected executable,
   the AEGIS launch helper rechecks the reviewed profile and policy identities and
   bytes, the selected executable identity and digest, the current working
   directory, and native reader shutdown. A failed check does not start Codex.
   These are point-in-time checks: files or executable can change after their
   checks and before use. The command does not supply a model, sandbox or
   approval override.
4. In Codex, inspect the session hook with `/hooks` and review and trust it
   manually if the installed Codex version supports that workflow. AEGIS does not
   alter trust. If the hook is untrusted, disabled, missing or overridden by
   managed configuration, do not assume it runs.
5. Use **Review Codex hook removal** for a fresh native review of the recognized
   AEGIS-owned entry. Removal preserves the separate draft and retained backups;
   it does not restore a personal Codex configuration or remove other layers.

Only the fixed single-entry profile is recognized. Existing arbitrary or modified
entries are not silently adopted. The renderer sends fixed operations, not policy
bytes or paths; paths and policy details appear only in the native reviews and the
owner-invoked terminal handoff.

## Decision and coverage boundary

The one-shot adapter supports a bounded documented `PreToolUse` envelope with
`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`,
`permission_mode`, `turn_id`, `tool_name`, `tool_use_id` and `tool_input`. It
accepts `Bash` with a nonempty command and applies the selected shared AEGIS policy
to the **entire** tool input and exact policy working directory. It rejects duplicate
or extra top-level fields, malformed values and unsupported command controls. The
input is limited to 64 KiB, with a 1.5-second internal deadline. These finite
limits can refuse otherwise valid requests from a different Codex version.

A shared policy **allow** produces an empty response, leaving Codex's normal
permissions and other hook layers to decide. A policy **deny** produces a fixed
Codex deny. Codex does not currently support `PreToolUse` ask; AEGIS maps an
**ask** to a fixed deny instead of approving it. The built-in schema-2 project
review policy returns ask for its supported ordinary commands, so this adapter
denies those commands. Malformed input, policy failure, size limits and the
adapter's own deadline attempt a fixed deny response without disclosing the
request, policy path or transcript. If output itself fails, the process cannot
start, or the provider handles a hook failure differently, this adapter cannot
ensure a denial reaches the host.

This route covers only the documented local Bash `PreToolUse` surface. A later
`write_stdin` to an existing unified-exec session does not receive another
`PreToolUse` check. Other tools, hosted tools, other sessions and launches outside
the copied command remain outside this profile. Existing user, project, plugin,
system and managed layers can also run or suppress hooks. AEGIS does not infer
which effective layers or trust settings the installed client uses.

Official documentation states that hook errors, timeouts and malformed responses
can fail without blocking the tool. The installed Codex version, actual hook trust
journey, live provider behavior, allowed or denied effects, and blocking are **not
qualified** by this source-level route. The native review and local fixture checks
are not proof of provider enforcement or complete OS containment. See the
[official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) and
[configuration guidance](https://learn.chatgpt.com/docs/developer-settings).
