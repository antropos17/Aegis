# Bounded model HTTPS rejection evidence

The private developer broker now validates response status, content type, duplicate
profile headers and absence of content encoding as soon as HTTPS response headers
arrive. An invalid profile destroys the request, response and isolated agent
without waiting for upstream body completion. The same response-profile function
also remains in the final bounded JSON/SSE parser. The transport continues to use
the existing selected descriptor, local CA, hostname and exact leaf pin.

The observed defect was a local HTTPS receiver that flushed `401` JSON headers
and deliberately left the response body open. Before the change, the real broker
was still awaiting that body after the test's one-second observation window;
its existing three-second exchange deadline eventually bounded the wait. After
the change, the same test observes `outcome-unknown` and server-side socket closure
within the observation window. The test verifies the receiver accepted exactly
one authorized dummy request with durable consumption already present.

`tests/main/model-broker-https-failure.test.js` adds 18 behavioral cases against
actual local HTTPS listeners. It covers unclosed error responses, missing/wrong/
duplicate content type, compression, five redirect statuses to an independently
counted second HTTPS receiver, in-flight revoke/cancel/close, replay through a
fresh owner, captured endpoint/credential changes, and positive finite JSON/SSE
responses. Redirect destinations receive zero connections or credentials. The
known dummy credential is absent from public failure receipts and persisted
ledger files. Accepted content still requires existing secret filtering and
durable terminal publication.

Verification used Windows, Node `v24.11.1`, source base
`b3c70ab3774af112d61fd3c29515666280aff0e7`, and one Vitest worker. The focused command
selected the new file and the existing model broker transport, controls, ledger,
broker, qualification and fixture setup files: **7 files, 84 tests passed**.
Existing TLS cases exercised wrong name, expiration, untrusted issuer and rotated
leaf with zero credential deliveries. Existing enabled-proxy positive controls,
DNS avoidance and diagnostic refusal cases also passed. Scoped ESLint, Prettier
and `npm run typecheck:main` returned zero; the main config has `checkJs=false`,
so that typecheck does not establish body-level checking of these JavaScript files.

The separate donor checkout and fixed diagnostic filenames use the coordinator's
spacious temporary data drive. Generated model fixture directories are removed by
the existing lifecycle owner. No generated model fixture directory remained after
the focused batch. Verification receipts are retained outside the repository, with
a 16 MiB total cap and fixed filenames; no unbounded tracing was enabled.

This is real host loopback TLS and HTTP behavior with synthetic policy authority,
fresh random dummy credentials, and checked-in finite fixture certificates whose
CA trust is supplied only to the isolated exchange agent. It does not establish
real provider authentication/billing, guest-to-host broker transport, protected
credential storage, arbitrary Internet destinations, production launch or complete
E5/A2 containment. The private factory remains activated by the qualification
owner; no public IPC or production caller is added. Every receipt keeps
`launchAllowed=false`. Broad final integrated checks and independent Astra review
are owned by the coordinator.
