use crate::{
    BootSessionId, BsdInfo, ContractError, LibprocReader, PidSample, PopulationCompleteness,
    ReadError,
};
use aegis_macos_libproc::{BsdInfo as NativeBsdInfo, NativeError, PidSample as NativePidSample};

/// Private safe seam uses the actual wrapper types on every tested target.
trait NativeApi {
    fn boot_session_id(&mut self) -> Result<String, NativeError>;
    fn list_pids(&mut self) -> Result<NativePidSample, NativeError>;
    fn bsd_info(&mut self, pid: u32) -> Result<NativeBsdInfo, NativeError>;
    fn unique_id(&mut self, pid: u32) -> Result<u64, NativeError>;
}

#[cfg(target_os = "macos")]
impl NativeApi for aegis_macos_libproc::NativeReader {
    fn boot_session_id(&mut self) -> Result<String, NativeError> {
        self.boot_session_id()
    }
    fn list_pids(&mut self) -> Result<NativePidSample, NativeError> {
        self.list_pids()
    }
    fn bsd_info(&mut self, pid: u32) -> Result<NativeBsdInfo, NativeError> {
        self.bsd_info(pid)
    }
    fn unique_id(&mut self, pid: u32) -> Result<u64, NativeError> {
        self.unique_id(pid)
    }
}

struct NativeAdapter<T>(T);

impl<T: NativeApi> LibprocReader for NativeAdapter<T> {
    fn boot_session_id(&mut self) -> Result<BootSessionId, ContractError> {
        BootSessionId::parse(&self.0.boot_session_id().map_err(map_error)?)
    }

    fn list_pids(&mut self) -> Result<PidSample, ContractError> {
        let sample = self.0.list_pids().map_err(map_error)?;
        let completeness = match sample.completeness {
            aegis_macos_libproc::PopulationCompleteness::BestEffort => {
                PopulationCompleteness::BestEffort
            }
        };
        Ok(PidSample {
            pids: sample.pids,
            completeness,
        })
    }

    fn bsd_info(&mut self, pid: u32) -> Result<BsdInfo, ContractError> {
        let info = self.0.bsd_info(pid).map_err(map_error)?;
        Ok(BsdInfo {
            pid: info.pid,
            ppid: info.ppid,
            name: info.name,
            start_seconds: info.start_seconds,
            start_microseconds: info.start_microseconds,
        })
    }

    fn unique_id(&mut self, pid: u32) -> Result<u64, ContractError> {
        self.0.unique_id(pid).map_err(map_error)
    }
}

fn map_error(error: NativeError) -> ContractError {
    match error {
        NativeError::ReadFailed => ContractError::Read(ReadError::ReadFailed),
        NativeError::ProcessGone => ContractError::Read(ReadError::ProcessGone),
        NativeError::NotSupported => ContractError::Read(ReadError::NotSupported),
        NativeError::InvalidData => ContractError::InvalidNativeData,
        NativeError::PopulationLimit => ContractError::InvalidPopulation,
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn read() -> Result<crate::Snapshot, ContractError> {
    crate::read_snapshot(&mut NativeAdapter(aegis_macos_libproc::NativeReader::new()))
}

#[cfg(test)]
#[path = "native_adapter_tests.rs"]
mod tests;
