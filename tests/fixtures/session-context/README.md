# Session context fixture provenance

These small synthetic, privacy-sentinel fixtures model selected fields from actual
provider formats. They contain no real prompts, credentials or user transcripts.

`replay-cases.cjs` copies these source fixtures with distinct privacy sentinels and
declares independent synthetic process/verifier/skew evidence plus fixed expected
capsules. `tests/main/tool-context-replay.test.js` composes the explicit reader,
parser, binder, correlator and capsule builder through scan audit admission, disk
spill/restart, canonical audit readback/export and the live file-access batcher.
It checks bounded source degradation and ambiguity without upgrading OS actor
attribution. Its injected file stamps, verified-binding labels and clock skew are
fixture evidence; they establish no native reader, receiver authentication,
production wiring, trusted live binding or launch acceptance (`launchAllowed=false`).

Claude Code's assistant `message.content[].tool_use` and user `tool_result` shapes
follow the existing Claude transcript usage adapter and the official hook/SDK
transcript documentation: https://platform.claude.com/docs/en/agent-sdk/sessions
and https://code.claude.com/docs/en/hooks. Tool block fields are also checked against
https://github.com/anthropics/claude-agent-sdk-python/blob/498e063489d08a36210dbfc5fa5f5b72b401ea62/src/claude_agent_sdk/types.py.
The fixture does not qualify an installed
Claude version or its process registry.

Codex is pinned to upstream `89461ea6833832b0551ce24ee32205824d5c108d`:
- https://github.com/openai/codex/blob/89461ea6833832b0551ce24ee32205824d5c108d/codex-rs/protocol/src/models.rs
- https://github.com/openai/codex/blob/89461ea6833832b0551ce24ee32205824d5c108d/codex-rs/protocol/src/protocol.rs

The canonical envelope serializer is also pinned:
https://github.com/openai/codex/blob/89461ea6833832b0551ce24ee32205824d5c108d/codex-rs/history/src/rollout_payload.rs.

The selected rollout subset is `session_meta.payload.id/cwd`,
`response_item.payload.function_call` with JSON-string `arguments`, and
`function_call_output` joined by `call_id`. Shell text is not an object oracle.
Custom-tool, MCP or encrypted argument records have no supported object extractor.

Gemini CLI is pinned to upstream `ed96faedfd5571f055c44f2c9509d62321d1138d`:
- https://github.com/google-gemini/gemini-cli/blob/ed96faedfd5571f055c44f2c9509d62321d1138d/packages/core/src/services/chatRecordingTypes.ts
- https://github.com/google-gemini/gemini-cli/blob/ed96faedfd5571f055c44f2c9509d62321d1138d/packages/core/src/services/chatRecordingService.ts
- https://github.com/google-gemini/gemini-cli/blob/ed96faedfd5571f055c44f2c9509d62321d1138d/packages/core/src/tools/read-file.ts

Current Gemini JSONL uses session metadata followed by `type: gemini` messages with
`toolCalls[]` containing `id`, `name`, `args` and `timestamp`. The explicit `json`
format also accepts legacy bounded ConversationRecord messages. History edits
(`$set`, `$patch`, `$rewindTo`) fail closed for this first subset. File tool
arguments use `file_path`; invented `absolute_path` aliases are not accepted.
Tool timestamps remain source-reported. Gemini's tool record has no explicit end,
so the caller must supply a documented bounded missing-end tolerance.

All paths are lexically normalized using explicit win32/posix semantics, with case
preserved. Symlinks, realpath identity, network IP-to-URL mapping, WSL-to-Windows
paths, alternate-home discovery, file replacement and source version detection
require the future confined reader/integration. No files are discovered here.
