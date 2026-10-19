//! Bounded libproc boundary. Native calls exist only on 64-bit macOS.
//! ABI/link/runtime qualification on each supported macOS SDK remains required.
#![deny(unsafe_op_in_unsafe_fn)]

mod reads;
#[cfg(target_os = "macos")]
mod system;

pub use reads::{BsdInfo, PidSample, PopulationCompleteness};

/// Fixed errors carry no process metadata or OS exception strings.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeError {
    ReadFailed,
    ProcessGone,
    NotSupported,
    InvalidData,
    PopulationLimit,
}

/// Fresh reads only; this type contains no birth or per-PID cache.
#[cfg(target_os = "macos")]
pub struct NativeReader;

#[cfg(target_os = "macos")]
impl NativeReader {
    pub const fn new() -> Self {
        Self
    }
    pub fn boot_session_id(&mut self) -> Result<String, NativeError> {
        reads::boot_session_id(&mut system::System)
    }
    pub fn list_pids(&mut self) -> Result<PidSample, NativeError> {
        reads::list_pids(&mut system::System)
    }
    pub fn bsd_info(&mut self, pid: u32) -> Result<BsdInfo, NativeError> {
        reads::bsd_info(&mut system::System, pid)
    }
    pub fn unique_id(&mut self, pid: u32) -> Result<u64, NativeError> {
        reads::unique_id(&mut system::System, pid)
    }
}

#[cfg(target_os = "macos")]
impl Default for NativeReader {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
