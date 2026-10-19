# sensor/1 JavaScript preparation fixtures

`cases.json` supplies literal expected JSON and direction for each binary frame.
`regenerate.cjs` prefixes these UTF-8 bytes with their unsigned four-byte
little-endian length. It never imports the production codec. Regenerate with
`node tests/fixtures/sensor-wire/regenerate.cjs`; files are byte-exact binary
fixtures protected by the repository's `.bin -text` attribute.

Cases cover every message and mode, both platforms, all event kinds, repeated
event PIDs, zero raw birth/capture time, all unavailable identity codes, Unicode,
empty permitted collections, values above 2^53 and the u64 maximum. All metadata
is synthetic. Paths/version strings/IPs/UUIDs are fixtures; no command arguments,
credentials, environment or real host observations are included.

JavaScript encoding/decoding must agree with the independent expected bytes and
JSON. The deferred Rust implementation must consume these same fixtures before
W1a is accepted. These files do not qualify native providers or the future host.
