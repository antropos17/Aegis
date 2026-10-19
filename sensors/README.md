# Sensor wire workspace

This workspace currently contains `aegis-wire`, the pure `sensor/1` codec shared
by future sensor binaries. The contract is
[the sensor wire specification](../docs/roadmap/sensor-wire.md). It has no OS
providers, process custody or host session state.

Rust **1.99.1** is pinned in `rust-toolchain.toml`, with the minimal profile,
Clippy and rustfmt. The initial local qualification used Rust 1.99.1 on Windows
MSVC. Cargo's lockfile records the resolved serde/serde_json dependencies.
From this directory:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

Set `CARGO_TARGET_DIR`, `TEMP` and `TMP` to a spacious disposable directory when
running local diagnostics. These commands do not install or qualify a native
Linux or macOS provider. Cross-platform runtime qualification, eBPF/procfs
parity and Endpoint Security entitlement behavior remain separate work.

`decode_payload(bytes, direction)` strictly admits one JSON body into owned
`Message`, `HostMessage` and `SensorMessage` types. `encode_frame(&message)`
revalidates producer-created fields and emits compact bytes in the JS codec's
field order. `DecimalU64` preserves full unsigned precision as decimal strings.
The serde derives support constructing typed data; direct serde deserialization
alone is not the wire validation boundary. Use these public codec functions for
untrusted input.

`FrameDecoder::push(bytes, callback)` delivers synchronously without accumulating
an output array or retaining the supplied chunk. Its callback returns
`Result<(), ()>`; `Err(())` is terminal `callback-failed`. An unwinding callback
panic also closes the decoder, but Rust invokes the application's panic hook
before unwinding; that hook and `panic=abort` behavior belong to the application.
Use callback errors for expected failure and keep sensitive data out of panic
messages. Exclusive borrowing prevents reentrant calls to this decoder; the
callback type excludes futures and byte slices exclude invalid chunk types.
`finish()` detects truncated input. Every terminal error clears pending bytes,
retains its first fixed code and prevents later delivery.

Admission enforces bodies from 1 byte through 8 MiB, sixteen containers, exact keys and numeric
spellings, duplicate-key rejection, valid scalar UTF-8, precise identities and
finite collection/text limits. Before constructing excess JSON nodes, admission
also caps arrays at 4,096 entries, objects at 16 keys and each frame at 140,000
structural nodes (values/containers plus decoded object keys). The largest legal
shape is 135,177 nodes: a batch of 4,096 connect events with available witnesses.
These budgets return `message-invalid` and prevent small-node allocation
amplification before the closed schema runs. Encoding bounds its temporary
payload to 8 MiB.
The tests consume every shared JSON/binary golden in
[`tests/fixtures/sensor-wire`](../tests/fixtures/sensor-wire), verify byte-exact
encoding, exercise every frame split, and cover malformed JSON, terminal errors,
identity contradictions and boundaries. Hello ordering, active capabilities,
request correlation, continuity across frames and transport custody belong to
the future host.
