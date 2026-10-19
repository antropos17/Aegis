//! Fresh macOS process identity and bounded libproc snapshot library.
//!
//! Native reads exist on macOS; transport and capture-mode activation remain separate.
mod identity;
mod native;
#[cfg(any(target_os = "macos", test))]
mod native_adapter;
mod snapshot;

pub use identity::{BootSessionId, ContractError, matches_watch_root};
pub use native::read_native_snapshot;
pub use snapshot::{
    BsdInfo, LibprocReader, PidSample, PopulationCompleteness, ReadError, Snapshot, read_snapshot,
};
