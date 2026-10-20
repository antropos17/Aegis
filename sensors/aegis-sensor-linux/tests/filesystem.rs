use aegis_sensor_linux::{FileSystemProcfs, ProcfsSource, SnapshotError, snapshot};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static SERIAL: AtomicU32 = AtomicU32::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "aegis-procfs-fixture-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::create_dir_all(path.join("sys/kernel/random")).unwrap();
        fs::write(
            path.join("sys/kernel/random/boot_id"),
            "11111111-1111-4111-8111-111111111111\n",
        )
        .unwrap();
        fs::write(path.join("sys/kernel/osrelease"), "6.8.0-fixture\n").unwrap();
        fs::create_dir(path.join("42")).unwrap();
        fs::write(
            path.join("42/stat"),
            format!(
                "42 (worker) S 1 {} 9007199254740993\n",
                vec!["0"; 17].join(" ")
            ),
        )
        .unwrap();
        Self(path)
    }
    fn source(&self) -> FileSystemProcfs {
        FileSystemProcfs::new(&self.0)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // This exact directory is created by this fixture, never an ancestor.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn filesystem_adapter_reads_only_boot_kernel_and_pid_stat_metadata() {
    let fixture = Fixture::new();
    let mut source = fixture.source();
    assert_eq!(source.kernel_version().unwrap(), "6.8.0-fixture");
    let rows = snapshot(&mut source).unwrap();
    assert_eq!(rows[0].birth.unwrap().get(), 9_007_199_254_740_993);
    fs::remove_file(fixture.0.join("42/stat")).unwrap();
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
}

#[test]
fn bounded_files_reject_oversize_and_invalid_utf8_without_truncating_identity() {
    let fixture = Fixture::new();
    let mut source = fixture.source();
    fs::write(fixture.0.join("42/stat"), vec![b'x'; 16_385]).unwrap();
    assert!(source.stat(42).is_err());
    fs::write(fixture.0.join("sys/kernel/random/boot_id"), vec![b'x'; 65]).unwrap();
    assert!(source.boot_id().is_err());
    fs::write(fixture.0.join("sys/kernel/osrelease"), vec![b'x'; 130]).unwrap();
    assert!(source.kernel_version().is_err());
    fs::write(fixture.0.join("sys/kernel/osrelease"), [255]).unwrap();
    assert!(source.kernel_version().is_err());
}

#[test]
fn invalid_proc_mount_or_non_directory_pid_fails_population_read() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("43"), b"not a process directory").unwrap();
    assert!(fixture.source().pids().is_err());
    let mut source = FileSystemProcfs::new(fixture.0.join("absent"));
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
}
