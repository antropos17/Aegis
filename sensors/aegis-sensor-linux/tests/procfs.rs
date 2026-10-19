use aegis_sensor_linux::{ProcfsSource, SnapshotError, parse_stat, snapshot};
use aegis_wire::{DecimalU64, Witness};
use std::collections::VecDeque;
use std::io;

const BOOT: &str = "11111111-1111-4111-8111-111111111111";

fn stat(pid: u32, name: &str, ticks: &str) -> Vec<u8> {
    format!(
        "{pid} ({name}) S 1 {} {ticks} 0 0\n",
        vec!["0"; 17].join(" ")
    )
    .into_bytes()
}

struct Source {
    boots: VecDeque<io::Result<String>>,
    pids: Vec<u32>,
    stats: VecDeque<io::Result<Vec<u8>>>,
}
impl Source {
    fn new(stats: Vec<io::Result<Vec<u8>>>) -> Self {
        Self {
            boots: [Ok(BOOT.into()), Ok(BOOT.into())].into(),
            pids: vec![42],
            stats: stats.into(),
        }
    }
}
impl ProcfsSource for Source {
    fn boot_id(&mut self) -> io::Result<String> {
        self.boots.pop_front().unwrap()
    }
    fn pids(&mut self) -> io::Result<Vec<u32>> {
        Ok(self.pids.clone())
    }
    fn stat(&mut self, _pid: u32) -> io::Result<Vec<u8>> {
        self.stats.pop_front().unwrap()
    }
}

#[test]
fn field_22_preserves_u64_precision_and_comm_delimiters() {
    assert!(parse_stat(&stat(42, "a (b))\nc", "18446744073709551615"), 42).is_ok());
    let row = parse_stat(&stat(42, "a (b))\nc", "18446744073709551615"), 42).unwrap();
    assert_eq!(row.name, "a (b))\nc");
    assert_eq!(row.ticks, u64::MAX);
    assert_eq!(row.ppid, 1);
}

#[test]
fn snapshot_emits_exact_composite_witness_from_this_pass() {
    let mut source = Source::new(vec![Ok(stat(42, "worker", "9007199254740993"))]);
    let rows = snapshot(&mut source).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].birth, Some(DecimalU64::new(9_007_199_254_740_993)));
    assert_eq!(
        rows[0].witness,
        Some(Witness::Linux {
            boot_id: BOOT.into(),
            start_ticks: DecimalU64::new(9_007_199_254_740_993),
        })
    );
    assert_eq!(rows[0].identity_error, None);
}

#[test]
fn non_utf8_comm_does_not_freeze_other_process_identities() {
    let mut raw_comm = stat(43, "bad~) (name\n", "18446744073709551615");
    *raw_comm.iter_mut().find(|byte| **byte == b'~').unwrap() = 0xff;
    let mut source = Source::new(vec![
        Ok(stat(42, "ordinary", "9007199254740993")),
        Ok(raw_comm),
    ]);
    source.pids = vec![42, 43];
    let observed = snapshot(&mut source);
    assert!(
        observed.is_ok(),
        "a legal non-UTF8 comm must preserve population availability"
    );
    let rows = observed.unwrap();
    assert_eq!(rows.len(), 2);
    for (row, pid, name, ticks) in [
        (&rows[0], 42, "ordinary", 9_007_199_254_740_993),
        (&rows[1], 43, "bad\u{fffd}) (name\n", u64::MAX),
    ] {
        assert_eq!(row.pid, pid);
        assert_eq!(row.name, name);
        assert_eq!(row.birth, Some(DecimalU64::new(ticks)));
        assert_eq!(
            row.witness,
            Some(Witness::Linux {
                boot_id: BOOT.into(),
                start_ticks: DecimalU64::new(ticks),
            })
        );
        assert_eq!(row.identity_error, None);
    }
    // The lossy display remains valid sensor/1 text; identity keeps its raw precision.
    assert!(
        aegis_wire::encode_frame(&aegis_wire::SensorMessage::Snap { id: 1, procs: rows }.into())
            .is_ok()
    );
}

#[test]
fn failed_pass_is_an_error_and_recovery_reads_new_generation() {
    let mut source = Source::new(vec![Err(io::ErrorKind::PermissionDenied.into())]);
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
    source.boots = [Ok(BOOT.into()), Ok(BOOT.into())].into();
    source.stats = [Ok(stat(42, "reused", "91"))].into();
    assert_eq!(
        snapshot(&mut source).unwrap()[0].birth,
        Some(DecimalU64::new(91))
    );
}

#[test]
fn missing_boot_malformed_records_or_empty_population_never_succeed() {
    for bytes in [
        stat(43, "wrong pid", "1"),
        stat(42, "bad ticks", "18446744073709551616"),
        stat(42, "bad", "01"),
        b"42 (short) S 1 2".to_vec(),
        stat(42, "nul\0name", "1"),
        vec![255],
    ] {
        assert_eq!(
            snapshot(&mut Source::new(vec![Ok(bytes)])),
            Err(SnapshotError::ReadFailed)
        );
    }
    let mut source = Source::new(vec![]);
    source.pids.clear();
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
    source.boots = [Err(io::ErrorKind::NotFound.into())].into();
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
}

#[test]
fn comm_display_bounds_and_empty_name_preserve_valid_identity() {
    let empty = parse_stat(&stat(42, "", "123"), 42).unwrap();
    assert_eq!(empty.name, "(unnamed)");
    assert_eq!(empty.ticks, 123);
    let mut expanded = stat(42, &"~".repeat(200), "9007199254740993");
    for byte in &mut expanded {
        if *byte == b'~' {
            *byte = 0xff;
        }
    }
    let row = parse_stat(&expanded, 42).unwrap();
    assert_eq!(row.name.len(), 255); // 85 complete U+FFFD characters.
    assert!(row.name.chars().all(|ch| ch == '\u{fffd}'));
    assert_eq!(row.ticks, 9_007_199_254_740_993);
    let mut invalid_tail = stat(42, "ordinary", "123");
    *invalid_tail.last_mut().unwrap() = 0xff;
    assert_eq!(
        parse_stat(&invalid_tail, 42),
        Err(SnapshotError::ReadFailed)
    );
}

#[test]
fn reboot_during_pass_discards_all_rows() {
    let mut source = Source::new(vec![Ok(stat(42, "worker", "123"))]);
    source.boots[1] = Ok("22222222-2222-4222-8222-222222222222".into());
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
}

#[test]
fn fresh_reused_pid_has_new_birth_without_a_cache() {
    let mut source = Source::new(vec![Ok(stat(42, "old", "123"))]);
    assert_eq!(
        snapshot(&mut source).unwrap()[0].birth,
        Some(DecimalU64::new(123))
    );
    source.boots = [Ok(BOOT.into()), Ok(BOOT.into())].into();
    source.stats = [Ok(stat(42, "new", "124"))].into();
    let fresh = snapshot(&mut source).unwrap();
    assert_eq!(fresh[0].name, "new");
    assert_eq!(fresh[0].birth, Some(DecimalU64::new(124)));
}

#[test]
fn unread_stat_never_recovers_an_old_generation() {
    let mut source = Source::new(vec![Ok(stat(42, "old", "123"))]);
    snapshot(&mut source).unwrap();
    source.boots = [Ok(BOOT.into())].into();
    source.stats = [Err(io::ErrorKind::PermissionDenied.into())].into();
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
}

#[test]
fn vanished_pid_is_skipped_but_duplicate_and_excess_populations_fail() {
    let mut source = Source::new(vec![
        Err(io::ErrorKind::NotFound.into()),
        Ok(stat(42, "live", "0")),
    ]);
    source.pids = vec![41, 42];
    assert_eq!(
        snapshot(&mut source).unwrap()[0].birth,
        Some(DecimalU64::new(0))
    );
    source.boots = [Ok(BOOT.into()), Ok(BOOT.into())].into();
    source.pids = vec![42, 42];
    source.stats = [Ok(stat(42, "live", "1"))].into();
    assert_eq!(snapshot(&mut source), Err(SnapshotError::ReadFailed));
    source.boots = [Ok(BOOT.into())].into();
    source.pids = vec![42; 4097];
    assert_eq!(snapshot(&mut source), Err(SnapshotError::RequestTooLarge));
    assert_eq!(
        parse_stat(&stat(42, "zero ticks", "0"), 42).unwrap().ticks,
        0
    );
}
