# Owned inert file read control

Status: executable synthetic fixture preparation. `S8-owned-file-read` writes a
fixed public inert canary into its own project compartment, then reads that
created file through one validated descriptor. This supplies controlled Node
fixture behavior only. It establishes no sensitive-file access, real agent,
OS read oracle, native provider attribution, Procmon confirmation, ATT&CK
qualification, calibrated latency/overhead or W8/T8 measurement acceptance.

## Scenario and expected stimulus

The scenario uses existing `write-fixture` followed by one new `read-fixture`
step. The read's closed `with` object contains only required `fromStep`, naming
an earlier `write-fixture`. Missing, forward or wrong-kind references and more
than one read are refused before any action. Arbitrary paths, directories,
content, offsets, lengths and commands are not read options. The actor requires
the actual runner-generated run ID. Legacy scenarios retain their behavior.

Only a complete validated read with confirmed descriptor closure emits
`file/access`, action `fixture-file-read`. It records the actual actor
PID/executable, returned byte count/hash and source step, a safe fixture label
and run binding. The access row contains no raw file path. Its
`bench.timestampBasis` is `harness-read-completion-observation`: the timestamp is
read after validation and closure, rather than an OS read timestamp or latency
observation. Creation rows keep existing path neutralization.

The unchanged join/metrics implementation leaves this access row at
`category-not-scored`, outside the four existing category denominators, even
with matching synthetic oracle/sensor rows. No outcome becomes an oracle, loss
receipt or scorer input.

## Creation and descriptor boundary

The fixture writer encodes UTF-8 once, creates exclusively, writes that exact
buffer through its descriptor and hashes the written buffer. It captures
descriptor dev/inode/size and closes in `finally`. The former unlabelled
`fs.readFileSync` content readback is removed. This avoids an unlabelled
preparatory read; it does not establish a cold cache, because the preceding
write itself can warm caches.

After close, final named timestamps are accepted only when named dev/inode/size
still match the original descriptor. The writer does not reopen an unverified
path to relax identity. This accommodates Windows timestamps updating on handle
close. Existing creation fields and `result.path` / `result.name` remain, with
an additive private in-memory `ownedFixture` token: version, registered
compartment, safe canary name, original identity, expected bytes/hash and
creation-closure fact. It contains no descriptor or raw source path and is never
persisted. Unavailable native identity remains `null`: creation remains a write
observation, while a read fails closed. No unique identity is fabricated.

The reader reconstructs its path under actual `ctx.runDir`, using only the
token's closed compartment/name. Ordinary ancestors, a regular terminal file
and one hard link are required before content access. Links, junctions,
directories, cross-run token replay and unsafe names/compartments are refused.
The caller must exclusively own a non-adversarial disposable directory. These
checks are neither OS containment nor an adversarial filesystem snapshot.

One `O_RDONLY | O_NOFOLLOW` descriptor is used where `O_NOFOLLOW` is available.
Original identity must agree with named and descriptor metadata before reading,
then descriptor and named metadata after reading. Digests cover native
dev/inode/size/mtime/ctime; access time is deliberately excluded. Same-content
replacement is refused by identity, rather than admitted through content hash.

Reads loop over legitimate short chunks until EOF, with one fixed 16 KiB buffer
plus a growth-sentinel byte. That cap covers UTF-8 encoding of the existing
writer's maximum 4096 UTF-16 content units. Completion requires exact original
size/hash, unchanged identity and confirmed close. Mutation, truncation, growth,
premature EOF, disappearance and replacement produce failure and no access row.
Returned bytes and their prefix hash remain visible on failure. If a later I/O
call throws, only counts returned by earlier successful calls are retained;
unseen progress is not inferred from buffer contents. `progressKnown: false`
makes that uncertainty explicit.

Closure is attempted once in `finally`. `closure.closed: true` means close
succeeded; an exception leaves it `null`, retains `closeAttempted: true` and
prevents success. An uncertain descriptor close is not retried. Reader failure
marks the actor step failed and skips later steps while preserving its outcome.
Already successful creation events remain in the catalogue.

## Separate safe artifact

After capture stops, the existing `writeScenarioArtifacts` hook writes
`file-read-outcomes.json` only when read outcomes exist. The loopback
`fixture-outcomes.json` format remains unchanged. Each `file-read-control/1`
outcome binds actual run/scenario/read step/source step and retains a safe
compartment/canary label, original/pre/post/final-named identity SHA-256 digests,
expected and returned byte counts/hashes, status, fixed reason, progress-known
flag and opened/close-attempted/closed facts. Unknown observations stay null.

Fixed reasons distinguish invalid token, unavailable identity, unsafe path,
before/during-read identity change, open/read failure, growth bound, after-read
metadata unavailability, length/hash mismatch and unconfirmed close. No raw
filesystem error, contents, private path, original metadata strings, command
line or environment is saved. Digests are integrity bindings, without source
authentication or an anonymity guarantee.

The writer validates closed enumerable ordinary data, noncoercing safe IDs,
labels/counts/reasons, source-step binding and the declared source's UTF-8
bytes/hash. Complete outcomes require matching identity, exact bytes/hash and
confirmed close. Duplicate/mismatched records, accessors, non-enumerable fields,
oversized facts and overwrite attempts produce fixed
`file-read-outcomes-invalid` errors. At most one outcome and 16 KiB are written
through exclusive creation in ordinary local directories. A write failure may
leave an incomplete fresh file; that is not a successful receipt. Flags
`osOracle`, `sourceAuthenticated`, `sensorScored` and `measurementAccepted` remain
false. The fixture's own checks do not supply an independent OS oracle.

## Verification and local execution

Tests reach actual `prepareScenario -> actor.execute -> writeScenarioArtifacts`
and real `run.main` arm C with host metadata replaced by a fixed test declaration.
A controlled arm-A failure checks stop-before-artifact ordering without native
helpers or Electron. Actual UTF-8 bytes, descriptor closure, hard links, an owned
junction/link compartment and replacements are exercised. Deterministic fs seams
isolate terminal symlink metadata, original identity and returned-buffer hash
checks. Fault cases cover partial progress, EOF, close exceptions, pre-activity
refusal, artifact binding/privacy and genuine exclusive-output races.

With the qualified Node runtime, fixture-only execution is:

```sh
node bench/run.js --scenario S8-owned-file-read --arm C
```

The legacy C path currently starts neither sensor nor OS oracle; this command
qualifies no capture or overhead mode. A/B retain existing prerequisites. S8's
Sysmon declaration does not implement ordinary-read confirmation. Real agent
tasks, sensitive-file semantics, independent OS admission and broader
[METHOD qualification](METHOD.md) remain owner work.
