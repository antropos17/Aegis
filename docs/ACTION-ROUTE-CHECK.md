# Selected-action route check (B1)

`--action-route-check-json <route> <policy.json> <request.json>` checks selected
configuration and current-process prerequisites before starting an execution route.
It reads the schema 2 policy and schema 1 request described in
[ACTION-EXECUTION.md](ACTION-EXECUTION.md).

```sh
node src/main/main.js --action-route-check-json direct /absolute/policy.json /absolute/request.json
```

| Route | Execution entry being checked | Ask behavior | Terminal requirement |
| --- | --- | --- | --- |
| `direct` | `--action-exec-json` | No launch | None |
| `terminal` | `--action-exec-confirm` | Fresh terminal confirmation | Current stdin and stderr are live TTYs |
| `mcp-stdio` | `--action-mcp-stdio` | No launch | None |
| `mcp-review` | `--action-mcp-review` | Fresh terminal confirmation per call | Current stdin and stderr are live TTYs |

The `terminal` and `mcp-review` routes also require fresh confirmation for an
`allow` policy decision. A policy deny cannot be overridden.

The checker never spawns the action, prompts, opens a listener, issues a grant or
writes configuration/settings. It uses the same runtime guard as execution and
confirmation: supported platform, no permission runtime and no enabled
child-process debug logging. Extracting that shared guard does not change the
execution routes' behavior.

## Report and exit status

Stdout contains one fixed-metadata JSON report with `schemaVersion: 1` and
`mode: action-route-check`. It includes the selected route and:

- `configuration`: `valid`, `invalid`, `unavailable` or `not-checked`;
  `policyDecision`: `allow`, `ask`, `deny` or `unknown`.
- `runtime`: `supported`, `unsupported` or `not-checked`;
  `terminal`: `available`, `unavailable`, `not-required` or `not-checked`;
  `terminalScope: checking-process-only`.
- `askBehavior`: `not-started` or `terminal-confirmation`;
  `control: direct-child-only`, `descendantControl: unsupported` and
  `outsideRouteCoverage: unknown`.
- `connection: not-checked`, `blockingVerification: not-performed`,
  `executionPerformed: false`, `authorization: none` and
  `configurationObservation: single-pass-not-retained`.

The fixed `gaps` list names other agent tools, outside-route filesystem/network
activity, descendants, executable-content binding, continuous configuration
watching and provider installation/version. `reason` contains only recognized
policy decisions, request/policy schema failures, input unavailability, runtime
failure or check cancellation/timeout/unavailability codes. No paths, arguments,
environment, file contents, private launch descriptors or arbitrary exception
messages enter the report.

Exit **0** means valid inputs, supported runtime and any required terminal were
observed. A valid policy **deny also exits 0**: this is a completed check, with no
permission granted. Exit **2** covers invalid/unavailable configuration, runtime
or required terminal, timeout and cancellation. Bad CLI arguments return exit
**1** with `expected-action-route-check-arguments`.

## Limits and interpretation

Preparation has a 1,500 ms deadline and reuses the bounded reader, with each
selected regular file limited to 64 KiB. Malformed JSON/read failures produce
unavailable input; parsed but invalid schemas produce invalid configuration.
Required-terminal absence still permits a configuration check, but makes the
overall CLI exit 2. Unsupported runtime leaves configuration unchecked.

The observation is read once and is not retained as a binding or approval. Files
can change afterward; there is no guarantee against that race. Actual execution
and confirmation still perform their own checks. The result proves neither a
future broker's terminal availability nor an endpoint connection, installed route,
provider identity/version or verified blocking. It does not check executable
existence/content, cwd contents or descendant isolation.

The checker does not construct the private confirmation preview or check its
size. A later real confirmation can still reject a preview exceeding 16 KiB.

Focused verification includes 20 native Node CLI tests, 27 core checks and nine
shared-runtime tests. Native cases cover all four routes, privacy, malformed and
missing files, no launch/prompt/listener, and denial by the real execution CLI
after a policy changes following a successful check. A native Windows PTY run
also checked `terminal`/ask and `mcp-review`/allow with an available terminal,
without prompting or creating the action's sentinel; owned scratch was removed.
Its receipt is `.agent/b1-route-check-native-receipt.json`. These local results
do not establish CI or publication status.
