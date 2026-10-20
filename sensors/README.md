# Sensor workspace

This workspace contains `aegis-wire`, the pure `sensor/1` codec, a process-only
Linux procfs provider with a framed CLI, and a macOS identity library with a
separate bounded native-read boundary.
The Linux implementation is described in [its crate guide](aegis-sensor-linux/README.md).
The macOS library connects fresh libproc observations to its identity consumer;
its executable and transport integration remain separate work. Native Linux
execution and macOS linkage, ABI and runtime behavior remain unqualified.
The codec contract is [the sensor wire specification](../docs/roadmap/sensor-wire.md).
The codec itself has no OS providers, process custody or host session state.

The platform roots inherit workspace package metadata and lints. All members
share `Cargo.lock`, following [Cargo's workspace model](https://doc.rust-lang.org/cargo/reference/workspaces.html).
Shared-file changes have one owner and land before dependent platform work,
as required by [the ownership plan](../docs/roadmap/completion-plan.md#53-worktrees-and-path-ownership).
The future eBPF crate and capability installer in that plan are not present.
The procfs delivery does not complete W2; W3 implementation remains separate.

Rust **1.99.1** is pinned in `rust-toolchain.toml`, with the minimal profile,
Clippy and rustfmt. The initial local qualification used Rust 1.99.1 on Windows
MSVC. Cargo's lockfile records the resolved serde/serde_json dependencies.
From this directory:

```sh
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked --offline
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

## Linux clock prerequisite

The Linux crate pins `rustix` 1.1.5 with its `time` feature and default features
disabled, only for Linux targets. Its safe `CLOCK_BOOTTIME` API supplies the
sensor clock without adding unsafe code to the sensor crate. The Linux clock
prerequisite added seven registry packages and updated the local Linux package's
dependency list while retaining its thirteen other existing package blocks.

A locked offline check for `x86_64-unknown-linux-gnu` verifies this dependency
configuration. That prerequisite alone added no process provider or executable
and established no native clock measurement or Linux runtime qualification. The
procfs delivery above uses it without changing that qualification boundary.

## macOS read boundary prerequisite

`aegis-sensor-macos/native` is the dependency-free `aegis-macos-libproc` crate.
It confines the unsafe libproc/sysctl calls to one macOS-only module and exposes
bounded safe readers with exact returned-size checks. Wire and sensor crates
continue to forbid unsafe code. The wrapper documents its Apple source layouts
and private process-unique-ID flavor in `native/SAFETY.md`.

PID enumeration is explicitly best effort, including underfilled buffers. Every
consumer must retain that uncertainty; a missing PID cannot establish an exit.
The sensor crate's `read_native_snapshot()` library entrypoint uses this boundary
on macOS and returns `NotSupported` elsewhere. It preserves best-effort population,
raw birth and generation witnesses. See [the identity contract](aegis-sensor-macos/IDENTITY.md).
Transport, clock integration and active capture modes remain separate work.

Portable wrapper tests and an `aarch64-apple-darwin` target check cover this
prerequisite. They do not verify native linkage, SDK ABI offsets, live permissions,
boot/process-generation behavior or macOS version support.
