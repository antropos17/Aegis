# Loaded scenario provenance

New `bench/run.js` manifests retain schema version 2 and add a versioned
`scenarioProvenance` field. It identifies the exact source bytes parsed by
`actor.loadScenario`, including whitespace and UTF-8 encoding, for the immutable
scenario object executed by the main runner. It does not authenticate the source
or accept a measurement. Historical manifests without this field remain
unverified; a hash must never be reconstructed and presented as their recorded
execution definition.

```json
{
  "version": 1,
  "loaded": { "sha256": "<64 lowercase hexadecimal characters>", "byteLength": 961 },
  "final": { "state": "pending", "sha256": null, "byteLength": null },
  "sourceAuthenticated": false,
  "measurementAccepted": false
}
```

The example byte length illustrates the shape; actual values come from the
script's loaded Buffer. SHA-256 and byte length describe all loaded bytes, with
no canonicalization. The loader decodes strict UTF-8 and parses that same Buffer;
initial provenance never rereads the source. Both source reads require 1–65,536
bytes. A bounded 65,537-byte buffer detects growth, and reads loop over legitimate
short chunks. Metadata is checked before and after the descriptor read and
against the named file. Exact BigInt filesystem identifiers and timestamps avoid
rounding large NTFS file IDs. Descriptor closure must succeed before bytes are
eligible. BigInts, raw source, paths, errors and filesystem identities are not
published in this field.

## Preparation and execution

The loader privately associates its parsed object, original digest and source
location using a WeakMap. `prepareScenario` retains its existing return shape and
mutable behavior for direct callers. Only the real `main` path seals the loaded
object after validation: it verifies that the parsed object has not changed,
then recursively freezes its owned JSON data before execution. An unrelated
object or a modified loaded object cannot acquire this binding through sealing.
Direct actor callers receive no automatic claim that a modified object represents
the original loaded bytes.

`manifest.collect` accepts an optional `preparedScenario`; it derives the initial
field only from a privately tracked, sealed object whose ID matches `scenario`.
Other callers, including runs without a scenario, receive `null`. The runner
writes the initial `pending` record before starting a sensor or executing steps.
The field describes the source snapshot; it makes no claim that a step, sensor
or oracle ran.

## Endpoint states and failures

After execution and confirmed sensor shutdown, the runner checks the original
source location again. `final.state` is one of:

| State | Recorded endpoint facts |
| --- | --- |
| `pending` | No published final check; digest and byte length are null. |
| `unchanged` | Both final digest and byte length equal the loaded values. |
| `changed` | Final bytes were read safely and digest or length differs. |
| `unavailable` | No eligible endpoint bytes; digest and byte length are null. |

`changed` and `unavailable` force a nonzero runner result while preserving the
step/catalogue artifacts already produced. A sensor startup refusal still retains
the loaded declaration and attempts the endpoint check without claiming step
execution. An unexpected execution failure can retain a final endpoint check
after cleanup. Shutdown confirmation requires an observed `handle.exit`; a
resolved stop request alone is insufficient because its exit wait can time out.
Failed or unconfirmed sensor shutdown leaves the initial `pending` record and
propagates failure while preserving an existing execution error; checking a still-active run is avoided. Abrupt termination
can also leave `pending`.

Final publication uses the fresh exclusive file
`manifest.scenario-provenance.tmp` in the owned run directory. It writes through
one descriptor, closes it successfully, then renames over the initial manifest.
Stage-open, write, close or rename failure reports only
`bench: scenario-provenance-write-unavailable` and returns failure. Before
replacement, the original pending manifest remains readable; a partial staged
file may remain. The runner does not delete a competing temporary file. This is
an ordinary owned-directory protocol, with no crash-durability guarantee.

Source files and ancestors must be ordinary caller-owned, non-adversarial paths.
Symlinks, junctions, hard-linked files, unavailable identities, oversized sources
and unstable reads refuse eligible evidence. `O_NOFOLLOW` is used where supplied
by Node; named/descriptor checks are also performed. These checks do not establish
adversarial filesystem containment.

Endpoint equality cannot prove the source remained unchanged between reads: a
temporary change followed by restoration is indistinguishable. The record does
not authenticate code, validate an agent, confirm an independent OS oracle,
measure completeness, or establish W8 acceptance. Consumer comparison against a
current inventory is a separate byte comparison and retains these limits.
