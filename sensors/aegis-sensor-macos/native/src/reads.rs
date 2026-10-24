// Kept portable so byte contracts and hostile backend lengths can be tested.
#![cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
use crate::NativeError;
use std::collections::HashSet;

pub(crate) const BSD_SIZE: usize = 136;
pub(crate) const UNIQUE_SIZE: usize = 56;
pub(crate) const PID_LIMIT: usize = 4096;

/// Projection of the complete BSD response; birth remains raw integer units.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BsdInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub start_seconds: u64,
    pub start_microseconds: u64,
}

/// Even an underfilled kernel reply can omit processes born during enumeration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopulationCompleteness {
    BestEffort,
}

/// Missing PIDs in this sample cannot establish authoritative process exits.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PidSample {
    pub pids: Vec<u32>,
    pub completeness: PopulationCompleteness,
}

pub(crate) trait Backend {
    fn pidinfo(&mut self, pid: i32, flavor: i32, out: &mut [u8]) -> Result<usize, NativeError>;
    fn listpids(&mut self, out: &mut [u8]) -> Result<usize, NativeError>;
    fn boot_uuid(&mut self, out: &mut [u8]) -> Result<usize, NativeError>;
}

fn pid_arg(pid: u32) -> Result<i32, NativeError> {
    if pid == 0 || pid > i32::MAX as u32 {
        return Err(NativeError::InvalidData);
    }
    Ok(pid as i32)
}

pub(crate) fn bsd_info(api: &mut impl Backend, pid: u32) -> Result<BsdInfo, NativeError> {
    let mut bytes = [0; BSD_SIZE];
    if api.pidinfo(pid_arg(pid)?, 3, &mut bytes)? != BSD_SIZE {
        return Err(NativeError::InvalidData);
    }
    let actual_pid = u32::from_ne_bytes(bytes[12..16].try_into().unwrap());
    let ppid = u32::from_ne_bytes(bytes[16..20].try_into().unwrap());
    let seconds = u64::from_ne_bytes(bytes[120..128].try_into().unwrap());
    let microseconds = u64::from_ne_bytes(bytes[128..136].try_into().unwrap());
    if actual_pid != pid
        || ppid > i32::MAX as u32
        || microseconds >= 1_000_000
        || seconds
            .checked_mul(1_000_000)
            .and_then(|s| s.checked_add(microseconds))
            .is_none()
    {
        return Err(NativeError::InvalidData);
    }
    let name = if bytes[64] == 0 {
        &bytes[48..64]
    } else {
        &bytes[64..96]
    };
    let length = name.iter().position(|b| *b == 0).unwrap_or(name.len());
    // The kernel can truncate these display bytes within a UTF-8 character.
    let name = String::from_utf8_lossy(&name[..length]);
    Ok(BsdInfo {
        pid,
        ppid,
        name: if name.is_empty() {
            "unknown".to_owned()
        } else {
            name.into_owned()
        },
        start_seconds: seconds,
        start_microseconds: microseconds,
    })
}

pub(crate) fn unique_id(api: &mut impl Backend, pid: u32) -> Result<u64, NativeError> {
    let mut bytes = [0; UNIQUE_SIZE];
    if api.pidinfo(pid_arg(pid)?, 17, &mut bytes)? != UNIQUE_SIZE {
        return Err(NativeError::InvalidData);
    }
    let value = u64::from_ne_bytes(bytes[16..24].try_into().unwrap());
    if value == 0 {
        return Err(NativeError::InvalidData);
    }
    Ok(value)
}

pub(crate) fn boot_session_id(api: &mut impl Backend) -> Result<String, NativeError> {
    let mut bytes = [0; 37];
    if api.boot_uuid(&mut bytes)? != bytes.len() || bytes[36] != 0 {
        return Err(NativeError::InvalidData);
    }
    if !bytes[..36].iter().enumerate().all(|(i, b)| {
        if [8, 13, 18, 23].contains(&i) {
            *b == b'-'
        } else {
            b.is_ascii_hexdigit()
        }
    }) {
        return Err(NativeError::InvalidData);
    }
    // The hexadecimal check above admits ASCII only.
    String::from_utf8(bytes[..36].to_ascii_lowercase()).map_err(|_| NativeError::InvalidData)
}

pub(crate) fn list_pids(api: &mut impl Backend) -> Result<PidSample, NativeError> {
    // Full caller buffers fail. An underfilled reply can still be incomplete:
    // the kernel independently sizes its internal list before taking its lock.
    let mut bytes = [0; (PID_LIMIT + 1) * 4];
    let size = api.listpids(&mut bytes)?;
    if size >= bytes.len() {
        return Err(NativeError::PopulationLimit);
    }
    if size == 0 || size % 4 != 0 {
        return Err(NativeError::InvalidData);
    }
    let mut pids = Vec::with_capacity(size / 4);
    let mut seen = HashSet::with_capacity(size / 4);
    for chunk in bytes[..size].as_chunks::<4>().0 {
        let pid = u32::from_ne_bytes(*chunk);
        if pid == 0 {
            continue;
        }
        pid_arg(pid)?;
        if !seen.insert(pid) {
            return Err(NativeError::InvalidData);
        }
        pids.push(pid);
    }
    Ok(PidSample {
        pids,
        completeness: PopulationCompleteness::BestEffort,
    })
}
