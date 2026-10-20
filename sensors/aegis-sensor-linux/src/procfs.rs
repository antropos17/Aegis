use aegis_wire::{DecimalU64, Process, Witness};
use std::collections::BTreeSet;
use std::io;

/// A closed snapshot failure; callers must not substitute a successful empty list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SnapshotError {
    ReadFailed,
    RequestTooLarge,
}
impl SnapshotError {
    /// Stable request error; paths and process metadata never enter diagnostics.
    pub const fn code(self) -> &'static str {
        match self {
            Self::ReadFailed => "read-failed",
            Self::RequestTooLarge => "request-too-large",
        }
    }
}

pub(crate) const MAX_PROCESSES: usize = 4096;
pub(crate) const MAX_STAT_BYTES: usize = 16 * 1024;

/// One coherent stat record; `ticks` is field 22, never epoch milliseconds.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stat {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub ticks: u64,
}

/// Reads are injected for deterministic races. Implementations bound file sizes.
pub trait ProcfsSource {
    fn boot_id(&mut self) -> io::Result<String>;
    fn pids(&mut self) -> io::Result<Vec<u32>>;
    fn stat(&mut self, pid: u32) -> io::Result<Vec<u8>>;
}

/// Parse structural fields as ASCII bytes. `comm` is display metadata and can
/// contain non-UTF8 bytes, parentheses and newlines without changing identity.
pub fn parse_stat(bytes: &[u8], expected_pid: u32) -> Result<Stat, SnapshotError> {
    let invalid = SnapshotError::ReadFailed;
    if bytes.len() > MAX_STAT_BYTES || expected_pid == 0 || expected_pid > i32::MAX as u32 {
        return Err(invalid);
    }
    let open = bytes.iter().position(|&byte| byte == b'(').ok_or(invalid)?;
    let close = bytes
        .iter()
        .rposition(|&byte| byte == b')')
        .filter(|&end| end > open)
        .ok_or(invalid)?;
    let pid = decimal(bytes[..open].trim_ascii()).ok_or(invalid)?;
    let comm = &bytes[open + 1..close];
    let tail = &bytes[close + 1..];
    if pid != u64::from(expected_pid) || comm.contains(&0) || !tail.is_ascii() {
        return Err(invalid);
    }
    let mut fields = tail
        .split(u8::is_ascii_whitespace)
        .filter(|field| !field.is_empty());
    let state = fields.next().ok_or(invalid)?;
    if state.len() != 1 || !state[0].is_ascii_alphabetic() {
        return Err(invalid);
    }
    let ppid = decimal(fields.next().ok_or(invalid)?).ok_or(invalid)?;
    if ppid > i32::MAX as u64 {
        return Err(invalid);
    }
    // State is field 3, PPID field 4; skip fields 5..21 to reach field 22.
    let ticks = decimal(fields.nth(17).ok_or(invalid)?).ok_or(invalid)?;
    Ok(Stat {
        pid: expected_pid,
        ppid: ppid as u32,
        name: display_comm(comm),
        ticks,
    })
}

/// Observe a pass with boot identity checked before and after enumeration.
pub fn snapshot(source: &mut impl ProcfsSource) -> Result<Vec<Process>, SnapshotError> {
    let boot = read_boot(source)?;
    let pids = source.pids().map_err(|_| SnapshotError::ReadFailed)?;
    if pids.len() > MAX_PROCESSES {
        return Err(SnapshotError::RequestTooLarge);
    }
    let mut seen = BTreeSet::new();
    let mut rows = Vec::with_capacity(pids.len());
    for pid in pids {
        if pid == 0 || pid > i32::MAX as u32 || !seen.insert(pid) {
            return Err(SnapshotError::ReadFailed);
        }
        let bytes = match source.stat(pid) {
            Ok(bytes) => bytes,
            Err(error) if gone(&error) => continue,
            Err(_) => return Err(SnapshotError::ReadFailed),
        };
        let stat = parse_stat(&bytes, pid)?;
        let birth = DecimalU64::new(stat.ticks);
        rows.push(Process {
            pid,
            ppid: stat.ppid,
            name: stat.name,
            birth: Some(birth),
            witness: Some(Witness::Linux {
                boot_id: boot.clone(),
                start_ticks: birth,
            }),
            identity_error: None,
        });
    }
    // Empty/unavailable populations cannot erase live host sessions.
    if rows.is_empty() || read_boot(source)? != boot {
        return Err(SnapshotError::ReadFailed);
    }
    rows.sort_unstable_by_key(|row| row.pid);
    Ok(rows)
}

pub(crate) fn read_boot(source: &mut impl ProcfsSource) -> Result<String, SnapshotError> {
    let value = source.boot_id().map_err(|_| SnapshotError::ReadFailed)?;
    let value = value.trim().to_ascii_lowercase();
    let valid = value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(value)
    } else {
        Err(SnapshotError::ReadFailed)
    }
}

pub(crate) fn gone(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::NotFound || error.raw_os_error() == Some(3) // Linux ESRCH
}

fn decimal(bytes: &[u8]) -> Option<u64> {
    std::str::from_utf8(bytes)
        .ok()?
        .parse::<DecimalU64>()
        .ok()
        .map(DecimalU64::get)
}

/// Display conversion is independent of raw ticks/PID parsing. Invalid UTF-8
/// sequences become U+FFFD; truncate only display text at a UTF-8 boundary.
fn display_comm(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "(unnamed)".into();
    }
    let mut name = String::from_utf8_lossy(bytes).into_owned();
    if name.len() > 256 {
        let mut end = 256;
        while !name.is_char_boundary(end) {
            end -= 1;
        }
        name.truncate(end);
    }
    name
}
