use crate::{BootSessionId, ContractError, identity::birth_usec};
use aegis_wire::{DecimalU64, Process, Witness};
use std::collections::HashSet;

/// Fixed read errors; never expose OS exception text or sensitive process data.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadError {
    ReadFailed,
    ProcessGone,
    NotSupported,
}

impl ReadError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ReadFailed => "read-failed",
            Self::ProcessGone => "process-gone",
            Self::NotSupported => "not-supported",
        }
    }
}

/// Owned projection of a complete `PROC_PIDTBSDINFO` response.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BsdInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub start_seconds: u64,
    pub start_microseconds: u64,
}

/// libproc enumeration remains sampling even when its caller buffer is underfilled.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopulationCompleteness {
    BestEffort,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PidSample {
    pub pids: Vec<u32>,
    pub completeness: PopulationCompleteness,
}

/// Observation rows with mandatory population uncertainty. Missing PIDs cannot
/// establish authoritative exits; a caller must retain `population` downstream.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Snapshot {
    pub processes: Vec<Process>,
    pub population: PopulationCompleteness,
}

/// Native boundary to implement and qualify separately on macOS 13 or later.
/// Each method must issue a new OS read, reject short/truncated responses and
/// never cache births. `list_pids` must fail on a full caller buffer. It must
/// preserve best-effort uncertainty even with an underfilled buffer. The list
/// excludes kernel PID zero and contains at most 4096 PIDs.
pub trait LibprocReader {
    fn boot_session_id(&mut self) -> Result<BootSessionId, ContractError>;
    fn list_pids(&mut self) -> Result<PidSample, ContractError>;
    fn unique_id(&mut self, pid: u32) -> Result<u64, ContractError>;
    fn bsd_info(&mut self, pid: u32) -> Result<BsdInfo, ContractError>;
}

/// Read a bounded population with a fresh boot bracket and per-PID unique-ID
/// brackets. Whole-pass errors return no snapshot; callers must freeze sessions.
/// Population enumeration is sampling, so short-lived processes can be missed.
pub fn read_snapshot(reader: &mut impl LibprocReader) -> Result<Snapshot, ContractError> {
    let boot = reader.boot_session_id()?;
    let sample = reader.list_pids()?;
    let pids = sample.pids;
    let mut seen = HashSet::with_capacity(pids.len().min(4096));
    if pids.len() > 4096
        || pids
            .iter()
            .any(|pid| *pid == 0 || *pid > i32::MAX as u32 || !seen.insert(*pid))
    {
        return Err(ContractError::InvalidPopulation);
    }
    let mut processes = Vec::with_capacity(pids.len());
    for pid in pids {
        processes.push(read_process(reader, pid, &boot)?);
    }
    let final_boot = reader.boot_session_id()?;
    if final_boot != boot {
        return Err(ContractError::BootChanged);
    }
    Ok(Snapshot {
        processes,
        population: sample.completeness,
    })
}

fn read_process(
    reader: &mut impl LibprocReader,
    pid: u32,
    boot: &BootSessionId,
) -> Result<Process, ContractError> {
    let before = match reader.unique_id(pid) {
        Ok(value) => value,
        Err(ContractError::Read(error)) => return Ok(unavailable(pid, error)),
        Err(error) => return Err(error),
    };
    if before == 0 {
        return Err(ContractError::InvalidUniqueId);
    }
    let info = match reader.bsd_info(pid) {
        Ok(value) => value,
        Err(ContractError::Read(error)) => return Ok(unavailable(pid, error)),
        Err(error) => return Err(error),
    };
    if info.pid != pid
        || info.ppid > i32::MAX as u32
        || info.name.is_empty()
        || info.name.len() > 256
        || info.name.contains('\0')
    {
        return Err(ContractError::InvalidProcess);
    }
    let birth = birth_usec(info.start_seconds, info.start_microseconds)?;
    let after = match reader.unique_id(pid) {
        Ok(value) => value,
        Err(ContractError::Read(error)) => return Ok(unavailable(pid, error)),
        Err(error) => return Err(error),
    };
    if after == 0 {
        return Err(ContractError::InvalidUniqueId);
    }
    if before != after {
        return Ok(unavailable(pid, ReadError::ProcessGone));
    }
    Ok(Process {
        pid,
        ppid: info.ppid,
        name: info.name,
        birth: Some(DecimalU64::new(birth)),
        witness: Some(Witness::Darwin {
            boot_session_id: boot.as_str().to_owned(),
            p_unique_id: DecimalU64::new(before),
        }),
        identity_error: None,
    })
}

fn unavailable(pid: u32, error: ReadError) -> Process {
    Process {
        pid,
        ppid: 0,
        name: "unknown".to_owned(),
        birth: None,
        witness: None,
        identity_error: Some(error.code().to_owned()),
    }
}
