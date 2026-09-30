# Bounded developer model broker

`createBoundedModelBroker({ authority, ledger, endpointPath, model })` is a private
trusted-owner factory. It registers the fixed `model.request` dispatcher with the
E4 session operation broker. It does not accept caller headers, credentials,
transport callbacks, endpoint selection or model replacement. No public IPC,
production caller or launch protocol activates this factory. All receipts keep
`launchAllowed=false`.

The owner supplies existing policy outcomes to its session authority. The generated
qualification owner makes an explicit trusted `allow` decision only for its own
disposable receiver; it makes no production policy or identity claim. A denied
policy outcome remains unissuable under the existing authority contract.

`prepare(operationId, Buffer)` copies and validates text-only request bytes and
retains a private route/model/quota snapshot. It returns a frozen prepared handle
with a frozen digest binding. The owner issues a capability using that binding.
`request(capability, prepared, { signal })` accepts only that exact private prepared
handle and dispatches through durable E4 consumption. Mutation of the caller's
original bytes, handle substitution, capability substitution and restart replay
cannot substitute an authorized request. The externally returned binding is for
private owner use; public qualification diagnostics contain no request digest.

The broker permits one concurrent exchange and sixteen non-refundable preparation
slots during a sixty-second owner lifetime. Invalid preparations consume slots
once the owner is live. Request and response bodies are limited to sixteen KiB,
headers to eight KiB, and each exchange to three seconds. Requests contain one to
four user messages and a requested output allowance of one to 256 tokens. The
token allowance is a wire request bound, not an independently measured tokenizer
or provider billing guarantee. Tools and unknown fields are refused.

Only literal `127.0.0.1` transport is admitted. The existing route capture detects
descriptor changes, credential substitution and unsafe Node diagnostics. HTTP
uses a dedicated direct agent; HTTPS reuses the existing CA/name/exact-leaf-pinned
agent. Neither uses ambient proxies or DNS discovery. Credentials are injected
only by the private host transport. Redirects, compression, ambiguous content type,
oversized headers/bodies and invalid UTF-8 fail closed.

The finite response profile accepts exact JSON completion or ordered SSE
`start`, one to 32 `delta` frames, then `complete`. It buffers the entire bounded
response, reconstructs text, and scans it before release. The selected dummy
credential and existing supported raw/base64/base64url/hex/percent/JSON-escaped
representations are automatically guarded using the shared known-secret scanner.
This is exact filtering of a selected value, with no general secret discovery or
arbitrary decoding claim. There is no incremental content release.

Text is returned only when E4 reports a committed `completed` terminal record.
Refused, lost-response, parse, secret-filter, cancellation and persistence failures
return fixed metadata without text or raw upstream errors. Reopened durable
consumption prevents automatic retry even when the receiver accepted bytes and
the response was lost. The operation signal combines capability cancellation,
revocation/expiry, explicit caller cancellation and owner lifetime/`close()`;
transport destruction bounds missing responses. E4's publication cutoff applies:
cancellation before the terminal decision preserves uncertainty; cancellation
after successful terminal publication is too late to revoke confirmed content.
`close()` stops admission, aborts transport and clears unused prepared state.
Running state is cleared after settlement, preserving that documented cutoff.
JavaScript string references are dropped; this does not claim guaranteed memory
erasure against a hostile same-principal process.

Run `node scripts/qualification/qualify-model-broker.mjs all` for ten fixed
generated scenarios. The harness starts only fixed loopback dummy HTTP/HTTPS
receivers, uses checked-in disposable certificates and fresh synthetic credentials,
and removes its exact generated fixture root.
Setup acquires directory, listener and socket cleanup ownership before publishing
the fixture handle. A setup failure closes acquired resources and removes only the
validated generated root; any cleanup failure retains the original failure as its cause.
Independent receiver counters check delivery, authorization, actual request bytes
and pre-delivery durable consumption.
Reports include `developerOnly=true`, counts, recovery state and fixed verdicts.
They contain no model content, endpoint, credential or low-entropy request digest.

Focused behavioral tests also cover actual terminal write/sync failure, cancellation
cutoff, replay across fresh owners, copied-byte mutation, concurrency, lifetime and
exchange deadlines, quota exhaustion, TLS certificate changes, enabled-proxy
positive controls, DNS avoidance, diagnostic children, malformed SSE and split
encoded credential echoes. These tests do not qualify real provider authentication,
billing, guest transport, credential isolation, network containment or production
launch. Full combined E4/E5 repository gates and independent review remain separate.
