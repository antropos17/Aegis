use crate::ProcfsSource;
use crate::procfs::{MAX_PROCESSES, MAX_STAT_BYTES};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Bounded file access. The native entrypoint always selects `/proc`.
/// A custom root exists for disposable fixtures; callers own its trust boundary.
pub struct FileSystemProcfs {
    root: PathBuf,
}

impl FileSystemProcfs {
    /// Select a procfs mount; no process state is retained between requests.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Kernel release, suitable for the closed hello version field.
    pub fn kernel_version(&self) -> io::Result<String> {
        let bytes = read_bounded(&self.root.join("sys/kernel/osrelease"), 129)?;
        let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?.trim();
        if text.is_empty() || text.len() > 128 || text.contains('\0') {
            return Err(invalid());
        }
        Ok(text.into())
    }
}

impl ProcfsSource for FileSystemProcfs {
    fn boot_id(&mut self) -> io::Result<String> {
        String::from_utf8(read_bounded(
            &self.root.join("sys/kernel/random/boot_id"),
            64,
        )?)
        .map_err(|_| invalid())
    }

    fn pids(&mut self) -> io::Result<Vec<u32>> {
        let mut pids = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(text) = name.to_str() else {
                continue;
            };
            if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            let pid = text.parse::<u32>().map_err(|_| invalid())?;
            if pid == 0 || pid > i32::MAX as u32 || pid.to_string() != text {
                return Err(invalid());
            }
            // Procfs root PID directories are real directories, never followed links.
            if !entry.file_type()?.is_dir() {
                return Err(invalid());
            }
            pids.push(pid);
            if pids.len() > MAX_PROCESSES {
                break;
            }
        }
        Ok(pids)
    }

    fn stat(&mut self, pid: u32) -> io::Result<Vec<u8>> {
        read_bounded(
            &self.root.join(pid.to_string()).join("stat"),
            MAX_STAT_BYTES,
        )
    }
}

fn read_bounded(path: &Path, maximum: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take((maximum + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > maximum {
        return Err(invalid());
    }
    Ok(bytes)
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "read-failed")
}
