# Claude Code authentication through a host broker

Research date: 2026-09-30. Documentation research only; no login, credential read, provider change or online request was performed. The previously observed Windows client was Claude Code 2.1.263 using Pro. These current documentation contracts have not been qualified on that executable or in a guest.

## Required boundary

The accepted [guest ADR](windows-vm-boundary-adr.md) keeps provider and subscription credentials outside the agent environment. The question is whether the official CLI can use the user's existing subscription through an endpoint-bound host broker while holding no provider credential in the guest. Successful gateway routing alone does not answer that question.

| Mode | Documented client behavior | Remaining AEGIS gap |
| --- | --- | --- |
| Pro/Max login | The CLI supports claude.ai login. On Windows its saved credential is in the profile's `.claude/.credentials.json`, or the selected configuration directory. [Authentication](https://code.claude.com/docs/en/authentication) | Guest login would give the client a provider credential inside the guest. It does not satisfy the host-only requirement. |
| API key | `ANTHROPIC_API_KEY` supplies the client key; `apiKeyHelper` returns a credential to the client. [Authentication](https://code.claude.com/docs/en/authentication) | Direct use exposes the provider key. A separate gateway could retain that key and issue a narrow local capability; AEGIS has not implemented or qualified that boundary. API billing is a separate user decision. |
| Subscription through a gateway | Setting only `ANTHROPIC_BASE_URL` retains the CLI's saved subscription login. The gateway forwards the OAuth capability header. [Gateways](https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways) | The documented route still uses the client-side saved OAuth. It does not document host-only credential injection into an otherwise credential-free guest CLI. |
| Gateway credential | An active gateway credential or `apiKeyHelper` replaces subscription authentication. Usage is billed to the upstream credential owner. [Gateways](https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways) | A gateway does not automatically preserve the user's Pro allowance. A guest capability must be constrained to the exact session and recipient. |
| OAuth environment token | `CLAUDE_CODE_OAUTH_TOKEN` supplies an OAuth token to the process. [Environment variables](https://code.claude.com/docs/en/env-vars) | Moving a token from disk to environment still gives it to the guest client. |

## Result and next qualification

Gateway routing with a subscription is documented. A credential-free guest CLI using a host-held subscription token remains **unverified** in the reviewed official documentation. This is not a claim of impossibility or a legal conclusion. Do not silently replace the user's subscription with paid API access.

Before selecting a real auth adapter, pin the installed CLI, its actual auth precedence and endpoint/header contract. Use dummy credentials and a local API stub to test startup, streaming, refresh failures, redirects, revocation, endpoint substitution and receipt redaction. A2 must cover the chosen host broker before real credentials are used. Any proposed subscription adapter needs a documented supported contract and version-specific evidence; a successful request alone cannot establish secret isolation.
