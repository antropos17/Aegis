# Credential and TCP sequence evidence

SEQ001 correlates a credential-file observation with a later TCP-table observation
within five minutes, using the same stamped `process.entity_id`. The production
rule opts into `evidence-policy: credential-egress-v1`; ordinary custom sequence
rules keep their declared severity and legacy evidence payload.

## Assessment

| Evidence | Maximum severity / held anomaly score |
| --- | --- |
| TCP tuple was observed before or at the file event | Informational / 0 |
| File-handle hold, incomplete tuple history, or missing/inferred owner evidence | Low / 30 |
| File-access event, confirmed ownership on both steps, complete TCP tuple first observed after the file event | Medium / 55 |

The declared YAML level is also a ceiling. A weaker calibrated observation cannot
erase an unexpired stronger score or extend that stronger score's ten-minute hold.
Every completed chain remains an audit record, including informational observations.
After a weak observation, the file anchor remains open for a stronger TCP observation
within the original window. Equal or weaker TCP repeats do not emit again. This
prevents an old socket listed first in a snapshot from hiding a later new socket.
An allowlisted API receives the same temporal assessment as any other endpoint;
the endpoint verdict is retained as context. All TCP ports are eligible.

Credential basenames include the existing password/credential patterns, `.env`
and its suffix variants, and `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`. SSH public
key `.pub` files do not match. A filename alone does not establish secret content:
sample `.env` files can match, and credentials in arbitrary filenames can be missed.

## Evidence and interface

Audit → open a sequence observation → Overview shows ordered steps, file path,
local/remote socket, first TCP observation time, recorded process identity,
per-step owner evidence and assessment reasons. Attributes retains the full record.
Legacy records without an assessment show that absence explicitly.

The raw network carrier now retains the OS TCP-owner evidence produced by its
same-call agent match. Missing owner evidence on either policy step makes aggregate
ownership unattributed; known evidence codes on the other step remain available.
No later PID lookup, agent-name join or parent/child merge is performed.

Only bounded metadata enters the sequence assessment. File contents, network
payloads, commands and arbitrary carrier fields are not copied. The existing
256-character file-path evidence limit still applies.

## Observation limits

This is temporal correlation. File-access sensors can observe open descriptors;
they do not prove which bytes were read. TCP-table observations contain no transmitted
content and do not establish credential transfer, causation or successful blocking.
Traffic through a previously observed connection remains unobserved even when its
sequence record is informational. High-level risk can still arise from other rules.

History holds at most 2,048 complete tuples, identified by process instance plus
local/remote IP and port, independent of TCP state. Entries expire after ten minutes
without observation; exit removes that instance's entries. Reinitialization and a
backward clock movement reset history. Eviction, expiry, missing tuples and clock
resets are counted in `getStats().sequences.tcpHistory` when the policy is enabled.
Tuple history is not an OS socket-lifetime registry: reuse, startup, eviction,
polling gaps and sensor outages can change the apparent first-observed time.

Cross-process and cross-agent causal chains remain the next A5 slice. Tests protect
the current boundary: separate instances, including reused PIDs and related agents,
cannot advance each other's chain. No pre-execution prevention or MCP gateway is
implemented by this change.
