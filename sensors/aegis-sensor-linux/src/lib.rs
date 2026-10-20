//! Linux process snapshots with fresh procfs identities and `sensor/1` replies.
//! Epoch conversion remains owned by the host's pinned D1 context.

mod filesystem;
mod procfs;
mod service;
pub use filesystem::FileSystemProcfs;
pub use procfs::{ProcfsSource, SnapshotError, Stat, parse_stat, snapshot};
pub use service::{Hello, ServeError, capabilities, serve};
