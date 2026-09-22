# Live observation of a selected MCP route

Action control can observe an explicitly selected running AEGIS MCP owner. This
B5 slice displays `Observed`, `Coverage lost`, connection generation, route,
selection, bounded counters, client-declared label/version and last receipt time.
It does not verify blocking, independently identify an installed agent, bind an
OS process, or cover other agent tools and descendants.

## Connect

Append `--observe <new-observation.json>` to one of the four owner commands:

```text
node src/main/main.js --action-mcp-stdio <policy> <request> --observe <new-observation.json>
node src/main/main.js --action-mcp-catalog-stdio <catalog> --observe <new-observation.json>
node src/main/main.js --action-mcp-review <policy> <request> <new-review.json> --observe <new-observation.json>
node src/main/main.js --action-mcp-catalog-review <catalog> <new-review.json> --observe <new-observation.json>
```

Use a private local directory controlled by the operator for the new descriptor.
For an MCP client, generate the selected/catalog owner's configuration with
`--action-mcp-config-json selected|catalog <paths...> --observe <new-observation.json>`.
The optional arguments are exported literally; generation does not create the
endpoint or start a listener. See [configuration generation](ACTION-MCP-CONFIG.md).
For terminal review, add the observation arguments to the broker command and
leave the agent's relay configuration unchanged; the generator rejects observation
on a relay.

While the owner is running, open **Action control → Live route observation →
Choose observation endpoint** and select its observation JSON. The desktop uses
its own read-only connection. Endpoint creation never overwrites an existing
file. Explicit opt-in startup failure returns status 2 before the MCP owner runs.
Observation is off by default.

Each endpoint accepts one authenticated observer. Stop observing detaches the
desktop without cancelling actions or stopping the agent. To reconnect, explicitly
start a new owner with a new endpoint and select it. There is no automatic retry,
installation, global discovery or retained trust across app restarts.

## Meaning of the states

`Waiting for MCP initialization` means the observation source is reachable but
the owner has not completed capture and the MCP initialized notification.
`Observed` means those steps completed and a valid fresh owner snapshot arrived.
Heartbeats occur once per second, including while execution/review is pending.
They do not consume MCP message IDs, messages or action-attempt budgets.

After an observed connection, owner closure, socket loss, malformed/replayed or
regressing data, a different generation, or 3.5 seconds without a valid update
causes sticky `Coverage lost`. Initial failures show `Observation unavailable`.
Freshness uses receiver monotonic time; displayed wall time is the last valid
receipt, not exact action time. Last received counters remain visible. Loss does
not prove an agent or direct child stopped. Desktop host failure also removes the
live label. An explicitly stopped observer stays stopped.
Sampling can miss short-lived states and work completed after the last heartbeat;
the retained snapshot is not a complete action history.

Client name/version come from MCP `initialize.clientInfo` and are **self-reported**.
Only fixed recognized labels and a bounded numeric three-part version survive;
other labels become `other`, other version formats become unavailable. They are
bound to this connection generation, not authenticated provider or process
identity. A local process can claim a recognized label/version.

Action attempts, owner invocations, settlements, failures and cancellation
requests keep their [MCP status meanings](ACTION-MCP-STATUS.md). An owner call can
settle with deny/ask without a launch; cancellation is not verified termination.
Configuration preflight remains a separate captured result.

## Boundary and retention

The descriptor has distinct `purpose: aegis-action-observation`, an ephemeral
loopback port and 256-bit bearer. Review-relay descriptors are rejected. The
observation server accepts only bearer authentication; subsequent client data
disconnects it. It never dispatches to an executor. One observer and at most eight
authentication attempts are accepted, with a three-second auth limit, 65-byte auth
buffer and 15-minute lifetime. Heartbeat output is bounded; a slow observer is
disconnected independently of execution.

The receiver accepts 4 KiB frames, at most 1 MiB total and a finite sequence. Exact
schema validation rejects extra fields, contradictory counters, rollback and
generation changes. Snapshots contain no paths, commands, arguments, environment,
request IDs, execution reports, bearer or raw client text. IPC adds only fixed
`observe-route`, `route-observation` and `stop-observing-route` selectors to the
existing owned-document local-review channel. Main owns native file selection.
Readback remains available during unrelated review dialogs. Document navigation
and window destruction close the observer.

Bearer possession permits reading metadata; it does not attest the publisher
binary or defend against a hostile same-user writer. Windows file ACLs are
inherited from the private parent directory; mode 0600 alone does not enforce
Windows privacy. Normal cleanup removes only the unchanged descriptor through
the existing endpoint helper. Abrupt process death may leave one stale descriptor;
it never establishes a live connection and is not reused automatically. No history
or per-heartbeat files are written. Do not publish the descriptor or its token.

## Verification and remaining work

Behavioral suites cover initialization/closure, auth rejection, read-only input,
replay/generation mismatch, rollback, malformed/oversized updates, expiry, endpoint
cleanup, native selection, navigation/disposal and renderer evidence loss. Native
Node fixtures exercise selected and catalog execution alongside observation
without consuming the MCP budget.

`node frontend/observatory/tests/action-observation-electron.mjs` runs a disposable
Node owner and production Electron renderer/preload/IPC. It uses a synthetic MCP
client and a native dialog stub selecting only the owned descriptor. It checks
initialization, policy deny with no sentinel effect, counters, disconnect, canaries,
keyboard activation and light/dark geometry. Fixed QA files go under
`.agent/b5-observation-native/`; review screenshots after 14 days or 64 MiB and
preserve receipts. No automatic cleanup policy is claimed.

Installed Windows Claude Code 2.1.263 also passed selected-action and catalog
observation through the generated configuration, using a disposable profile,
dummy credential and synthetic loopback API. Each route exercised allow/deny/ask
with 12 local API requests and no rejected proxy requests. Only allow wrote the
selected sentinel once; the unused catalog action never ran. The production
observer recorded zero attempts before the action, one settled invocation after
it, stable per-connection metadata, fresh generations between runs, sticky loss
on owner exit and descriptor removal. Owned scratch was removed in both runs.
The CLI version and MCP client metadata are distinct observations; neither is an
independent attestation of the connected provider.

Repeat explicitly on Windows (use `--catalog-observation` for the second route):

```text
node scripts/verify-claude-action-mcp.mjs --observation --claude <absolute claude.exe> --bash <absolute Git bash.exe> --scratch <existing spacious private directory>
```

The fixture holds synthetic replies for at most 2.5 seconds at each observation
checkpoint and waits at most 4 seconds for final loss/cleanup. Provider runs keep
their existing 30-second deadline and 16 MiB scratch bound; observation-mode HTTP
connections have a 10-second lifetime. Saved user settings are not changed. The
rejecting proxy is not OS firewall isolation. Receipts are
`.agent/b5-provider-observation-{selected,catalog}.json`; preserve them and review
fixed-name diagnostic logs after 14 days or 64 MiB. No automatic retention is
claimed. These normal-exit scenarios do not establish cloud-model behavior or
abrupt-kill cleanup.

The selected-action terminal review route was also verified with installed Claude
Code 2.1.263 and the same synthetic local API. Its four cases cover confirmed ask,
declined ask, policy deny and provider disconnect while awaiting confirmation:

```text
node scripts/verify-claude-action-mcp.mjs --review-observation --claude <absolute claude.exe> --bash <absolute Git bash.exe> --scratch <existing spacious private directory>
```

Keep stdout visible in the live terminal. Before entering the displayed challenge
or `no`, wait for `{"mode":"review-observation","pendingObserved":true}`. The
fixture never supplies an answer. The local verification used terminal input from
automation for the disposable action; this does not establish human identity or
human review. The disconnect case terminates only its owned provider tree after
observing one invocation, zero settlements and no sentinel effect. Policy deny
does not prompt. The three cases that return a tool result observe settlement
before the final synthetic reply. Every case requires sticky loss, a fresh
connection generation and removal of both descriptors before scratch cleanup.

The measured run made seven local API requests, rejected no proxy requests and
passed all four cases. Only confirmed ask created the sentinel. Pending disconnect
returned no tool result and created no sentinel; its last observed settlement
count remained zero. `cancellationRequests` stayed zero: this verifies a transport
disconnect during review, not an MCP cancellation notification or interruption of
an already-running child. Review
runs retain their 90-second provider deadline and 60-second confirmation timeout;
observation checkpoints keep the 2.5-second/4-second bounds above. Preserve the
redacted receipt separately; the verification receipt is
`.agent/b5-review-observation-passed.json`.

Catalog terminal review observation is available through the same verifier:

```text
node scripts/verify-claude-action-mcp.mjs --catalog-review-observation --claude <absolute claude.exe> --bash <absolute Git bash.exe> --scratch <existing spacious private directory>
```

It keeps two selected actions in one connection. Before answering the first or
second preview, wait for `pendingObserved:true` with the matching `review` number
in the `catalog-review-observation` readiness line. Confirm the first challenge,
decline the second with `no`; the third review disconnects automatically after
its pending observation. Terminal input remains external to the fixture.

Installed Windows Claude Code 2.1.263 passed this sequence using three local
synthetic API requests and no rejected proxy requests. Pending snapshots showed
invocation/settlement counts 1/0, 2/1 and 3/2; the first two returned reports had
settled snapshots 1/1 and 2/2. Only the confirmed first action wrote one byte.
The second marker stayed absent, including after disconnect. The final retained
snapshot was 3/2 with sticky connection-closed loss, unchanged self-reported
client metadata and zero cancellation notifications. Both descriptors and owned
scratch were removed without fallback owner abort. Broker exit 2 reflected the
forced relay transport closure and was accepted only with confirmed cleanup.

The receipt `.agent/b5-catalog-review-observation-passed.json` contains public
frames and fixed outcome fields; paths and terminal challenges are excluded.
Terminal answers were supplied by automation, which does not authenticate a
human. This uses the same 90-second run, 2.5-second checkpoint and 4-second cleanup
bounds, disposable configuration and synthetic local replies described above.
Abrupt owner death remains unverified. Installed-provider cancellation is covered below.

## Running-child cancellation in the protocol fixture

`tests/main/action-observation-cancellation.test.js` joins the production MCP
stream transport, policy/binding checks, execution owner and observation socket.
For both one selected action and a two-action catalog, a disposable real Node
child writes a bounded-lifetime progress marker. A wrong JSON ID type and an
unrelated ID leave the same child running; two matching cancellation notifications
produce one cancellation count and one settlement. The executor reports
`action-cancelled`, `interrupted` and confirmed termination. An existing test seam
forwards the real spawn unchanged and retains that ChildProcess object's exit and
close events as separate evidence of termination.

Both native Windows cases passed: marker growth stopped, the other catalog action
stayed unused, the cancelled tool result was suppressed and reuse of its request
ID was rejected without another launch. Observation retained its connection and
client metadata, then recorded sticky loss after normal owner close; the descriptor
was removed. Removing cancellation delivery made both tests fail. Public status
and observation still make no termination claim and include no private marker paths.

These tests use local in-memory MCP streams, a real observation socket and real
direct children. Terminal approval, an installed provider's cancellation behavior,
descendant termination, abrupt owner death and independent provider identity are
outside this verification. No provider or cloud model is launched by this fixture.

Independent agent/version binding, safe installed-adapter blocking tests and
verified outside-route control remain open. B5 is partial.

## Installed-provider running-child cancellation

The opt-in verifier now supports `--cancellation` and `--catalog-cancellation`:

```text
node scripts/verify-claude-action-mcp.mjs --cancellation --claude <absolute claude.exe> --bash <absolute Git bash.exe> --scratch <existing spacious private directory>
```

Both modes passed on Windows with installed Claude Code 2.1.263. Each run used
one synthetic loopback API request, a disposable profile and a dummy credential;
no cloud model or saved client settings were used. The fixture uses the
[SDK control protocol](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)
to initialize stream-json input and request `interrupt`. The request is sent only
after the selected real Node child is running, its private progress marker grows,
and production observation records one invocation with zero settlements.
The [redacted evidence](recon/evidence/claude-running-cancellation-windows-20260922.json)
records both runs and canonical LF hashes of the verifier and exercised modules.

Claude acknowledged the interrupt and delivered one MCP cancellation notification.
The production executor reported `action-cancelled`, `interrupted` and confirmed
termination. An explicitly loaded test witness forwards the existing spawn seam
unchanged and retains the held ChildProcess's exit/close events; public settlement
counters alone are insufficient. Marker growth stopped, the unused catalog action
never ran, and the connection remained observed with counters 1 invocation,
1 settlement and 1 cancellation before closing normally. Owner exit then caused
sticky coverage loss and descriptor removal. Both owned scratch directories were
removed. The client metadata is still self-reported.

The installed CLI returned exit 1 and an `error_during_execution` result after
interruption. The verifier accepts that combination only with the acknowledgement,
all independent cancellation/termination evidence and successful cleanup. A timeout,
fallback tree kill, missing exit/close or closure-triggered cancellation cannot pass.
Removing cancellation delivery from the production owner made the native selected
case fail its checkpoint; scratch cleanup still completed, and source was restored.

The provider has a 30-second deadline and the existing 16 MiB scratch limit. Each
checkpoint after launch waits at most 2.5 seconds, cleanup waits at most 4 seconds,
and the ordinary executor retains its 5-second runtime bound. The disposable child
also exits itself after 8 seconds if its owner disappears. Provider stdout stays
bounded in memory and is not included in the receipt; witness results are projected
to six fixed fields. Receipts contain no marker paths, endpoint credentials or raw
provider output. Preserve verification receipts; review fixed diagnostic files after
14 days or 64 MiB. No global retention mechanism is installed.

This closes the selected/catalog direct-stdio installed-provider cancellation
verification gap. Terminal-review cancellation, descendant termination, abrupt
owner death, independent provider identity and outside-route control remain open.
