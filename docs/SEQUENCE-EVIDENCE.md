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
SEQ001 performs no later PID lookup, agent-name join or parent/child merge.
SEQ002 uses the separately recorded relationship described below.

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

SEQ001 still isolates process instances. The separate SEQ002 rule below observes
direct relatives. No pre-execution prevention or MCP gateway is implemented here.

## SEQ002: direct relatives

`relationship: direct-parent-child` opts a credential-egress policy rule into a
separate bounded tracker. The file's `process.entity_id` keys its anchor; a later
TCP observation must belong to the other endpoint of a directly observed parent
edge. Both directions are supported, including differently named AI agents.
The network actor is the detection's top-level subject; each step retains its own
agent, PID, instance identity and attribution. No identity or file owner is rewritten.

`process-utils` stamps `parentRelation` from the same fresh process map used for
birth/identity enrichment. Both endpoints must be monitored, unambiguous OS-backed
instances whose births match that map. The parent must be strictly older than the
child. Equal timestamps, missing births, recycled newer parents, synthetic identities
and cached name chains cannot establish a relation. The relation is rebuilt each pass.

The engine accepts a population after reliable, non-degraded, non-straddled
reconciliation. A relationship must be available at the file event and still present
at the TCP event. Receipt time of the completed process pass timestamps the snapshot;
this is not an OS event creation time. Its usable age is at most 30 seconds. Long
scan intervals can therefore leave periods without related coverage. Failure, missing
edges, stop, exit, reload, backward clock movement and stale snapshots invalidate
pending related evidence. Normal fresh snapshots preserve the original five-minute
file window. Query latency and observation gaps remain limits.

SEQ002 caps severity at low (score 30) and existing TCP tuples remain informational.
Only a strictly stronger observation for an edge emits again within that file anchor;
repeats do not prolong a score. Only the TCP actor can receive this related score,
and a stronger existing score survives. Process ancestry does not establish delegation,
shared credentials, transferred content or causal wrongdoing.

`getStats().sequences.related` reports edges, pending anchors, emitted detections,
invalidations, expiry, eviction and dropped-edge counts. The tracker admits at most
4,096 population records, 1,024 edges, 64 neighbors per instance and 256 pending file
anchors across its rules. Oversized populations invalidate the tracker; edge and
anchor caps expose drops. It stores metadata only, with no file or TCP payload reads.

Audit details show both participants and the relationship snapshots alongside the
ordered evidence. Siblings, indirect descendants, unmonitored helper processes and
unrelated agents sharing names, working directories or display groups remain outside
this slice. General causal chains and independently linked agent handoffs remain A5 work.
