use crate::{ContractError, Snapshot};

/// Read fresh libproc observations on macOS, retaining best-effort population.
/// On other platforms this fails explicitly without OS reads or synthesized data.
/// This library entrypoint does not activate a transport or a sensor mode.
pub fn read_native_snapshot() -> Result<Snapshot, ContractError> {
    #[cfg(target_os = "macos")]
    {
        crate::native_adapter::read()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(ContractError::Read(crate::ReadError::NotSupported))
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    #[test]
    fn native_entrypoint_is_explicitly_unsupported_on_this_os() {
        assert_eq!(
            super::read_native_snapshot(),
            Err(crate::ContractError::Read(crate::ReadError::NotSupported))
        );
    }
}
