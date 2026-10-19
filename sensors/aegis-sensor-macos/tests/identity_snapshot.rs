use aegis_sensor_macos::*;
use aegis_wire::{DecimalU64, Process, SensorMessage, WatchRoot, Witness, encode_frame};
use std::collections::VecDeque;

const BOOT: &str = "11111111-2222-3333-4444-555555555555";
const OTHER_BOOT: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
type Read<T> = Result<T, ContractError>;
struct Fake {
    boots: VecDeque<Read<BootSessionId>>,
    pids: Read<Vec<u32>>,
    ids: VecDeque<Read<u64>>,
    info: Read<BsdInfo>,
    calls: Vec<&'static str>,
}
impl Default for Fake {
    fn default() -> Self {
        Self {
            boots: std::iter::repeat_n(Ok(BootSessionId::parse(BOOT).unwrap()), 2).collect(),
            pids: Ok(vec![42]),
            ids: [Ok(9_007_199_254_740_993); 2].into(),
            info: Ok(BsdInfo {
                pid: 42,
                ppid: 1,
                name: "node".into(),
                start_seconds: 1_700_000_000,
                start_microseconds: 123,
            }),
            calls: vec![],
        }
    }
}
impl LibprocReader for Fake {
    fn boot_session_id(&mut self) -> Read<BootSessionId> {
        self.calls.push("boot");
        self.boots.pop_front().expect("fresh boot read")
    }
    fn list_pids(&mut self) -> Read<PidSample> {
        self.calls.push("pids");
        self.pids.clone().map(|pids| PidSample {
            pids,
            completeness: PopulationCompleteness::BestEffort,
        })
    }
    fn unique_id(&mut self, pid: u32) -> Read<u64> {
        assert_eq!(pid, 42);
        self.calls.push("unique");
        self.ids.pop_front().expect("fresh ID read")
    }
    fn bsd_info(&mut self, pid: u32) -> Read<BsdInfo> {
        assert_eq!(pid, 42);
        self.calls.push("bsd");
        self.info.clone()
    }
}
fn observed(fake: &mut Fake) -> Process {
    let mut snapshot = read_snapshot(fake).unwrap();
    assert_eq!(snapshot.population, PopulationCompleteness::BestEffort);
    snapshot.processes.remove(0)
}
fn root(process: &Process) -> WatchRoot {
    WatchRoot {
        pid: process.pid,
        birth: process.birth.unwrap(),
        witness: process.witness.clone().unwrap(),
    }
}

#[test]
fn fresh_read_order_and_exact_raw_precision_survive_wire_roundtrip() {
    let mut fake = Fake::default();
    let process = observed(&mut fake);
    assert_eq!(
        fake.calls,
        ["boot", "pids", "unique", "bsd", "unique", "boot"]
    );
    assert_eq!(process.birth.unwrap().get(), 1_700_000_000_000_123);
    assert_eq!(
        process.witness,
        Some(Witness::Darwin {
            boot_session_id: BOOT.into(),
            p_unique_id: DecimalU64::new(9_007_199_254_740_993)
        })
    );
    let message = SensorMessage::Snap {
        id: 1,
        procs: vec![process.clone()],
    }
    .into();
    let frame = encode_frame(&message).unwrap();
    assert_eq!(
        aegis_wire::decode_payload(&frame[4..], aegis_wire::Direction::SensorToHost).unwrap(),
        message
    );
    assert!(matches_watch_root(&process, &root(&process)));
}
#[test]
fn pid_reuse_in_same_millisecond_rejects_old_watch() {
    let first = observed(&mut Fake::default());
    let watch = root(&first);
    let mut fake = Fake {
        ids: [Ok(9_007_199_254_740_994); 2].into(),
        ..Fake::default()
    };
    fake.info.as_mut().unwrap().start_microseconds = 999;
    let second = observed(&mut fake);
    assert_eq!(
        first.birth.unwrap().get() / 1000,
        second.birth.unwrap().get() / 1000
    );
    assert!(!matches_watch_root(&second, &watch));
    let mut same_birth = second.clone();
    same_birth.birth = first.birth;
    assert!(!matches_watch_root(&same_birth, &watch)); // witness comparison is essential
    let mut same_witness = first.clone();
    same_witness.birth = second.birth;
    assert!(!matches_watch_root(&same_witness, &watch)); // raw birth comparison is essential
}
#[test]
fn boot_session_and_pid_are_required_watch_dimensions() {
    let process = observed(&mut Fake::default());
    let watch = root(&process);
    let mut changed = process.clone();
    changed.pid += 1;
    assert!(!matches_watch_root(&changed, &watch));
    if let Some(Witness::Darwin {
        boot_session_id, ..
    }) = &mut changed.witness
    {
        *boot_session_id = OTHER_BOOT.into();
    }
    changed.pid = process.pid;
    assert!(!matches_watch_root(&changed, &watch));
}
#[test]
fn unique_change_between_reads_discards_all_metadata_and_identity() {
    let mut fake = Fake {
        ids: [Ok(7), Ok(8)].into(),
        ..Fake::default()
    };
    let process = observed(&mut fake);
    assert_eq!(process.birth, None);
    assert_eq!(process.witness, None);
    assert_eq!(process.identity_error.as_deref(), Some("process-gone"));
    assert_eq!(process.ppid, 0);
    assert_eq!(process.name, "unknown");
}
#[test]
fn each_read_failure_preserves_null_identity_and_fixed_error() {
    for error in [
        ReadError::ReadFailed,
        ReadError::ProcessGone,
        ReadError::NotSupported,
    ] {
        for stage in 0..3 {
            let mut fake = Fake::default();
            match stage {
                0 => fake.ids[0] = Err(ContractError::Read(error)),
                1 => fake.info = Err(ContractError::Read(error)),
                _ => fake.ids[1] = Err(ContractError::Read(error)),
            }
            let process = observed(&mut fake);
            assert_eq!(process.birth, None);
            assert_eq!(process.witness, None);
            assert_eq!(process.identity_error.as_deref(), Some(error.code()));
            encode_frame(
                &SensorMessage::Snap {
                    id: 1,
                    procs: vec![process],
                }
                .into(),
            )
            .unwrap();
        }
    }
}
#[test]
fn later_outage_never_reuses_prior_birth() {
    let mut fake = Fake::default();
    let first = observed(&mut fake);
    let watch = root(&first);
    fake.boots = std::iter::repeat_n(Ok(BootSessionId::parse(BOOT).unwrap()), 2).collect();
    fake.ids = [Err(ContractError::Read(ReadError::ReadFailed))].into();
    let second = observed(&mut fake);
    assert_eq!(second.birth, None);
    assert!(!matches_watch_root(&second, &watch));
}
#[test]
fn population_and_boot_failures_return_no_partial_snapshot() {
    let mut fake = Fake::default();
    fake.boots[1] = Ok(BootSessionId::parse(OTHER_BOOT).unwrap());
    assert_eq!(read_snapshot(&mut fake), Err(ContractError::BootChanged));
    let mut fake = Fake::default();
    fake.boots[1] = Err(ContractError::Read(ReadError::ReadFailed));
    assert_eq!(
        read_snapshot(&mut fake),
        Err(ContractError::Read(ReadError::ReadFailed))
    );
    let mut fake = Fake {
        pids: Err(ContractError::Read(ReadError::ReadFailed)),
        ..Fake::default()
    };
    assert_eq!(
        read_snapshot(&mut fake),
        Err(ContractError::Read(ReadError::ReadFailed))
    );
    for pids in [vec![0], vec![42, 42], vec![u32::MAX], vec![42; 4097]] {
        let mut fake = Fake {
            pids: Ok(pids),
            ..Fake::default()
        };
        assert_eq!(
            read_snapshot(&mut fake),
            Err(ContractError::InvalidPopulation)
        );
        assert_eq!(fake.calls, ["boot", "pids"]);
    }
    let mut fake = Fake {
        pids: Ok(vec![]),
        ..Fake::default()
    };
    assert_eq!(
        read_snapshot(&mut fake),
        Ok(Snapshot {
            processes: vec![],
            population: PopulationCompleteness::BestEffort
        })
    );
    assert_eq!(fake.calls, ["boot", "pids", "boot"]);
}

#[test]
fn missing_pid_in_later_sample_retains_uncertainty_about_exit() {
    let mut fake = Fake::default();
    let first = read_snapshot(&mut fake).unwrap();
    assert_eq!(first.processes.len(), 1);
    assert_eq!(first.population, PopulationCompleteness::BestEffort);
    fake.boots = std::iter::repeat_n(Ok(BootSessionId::parse(BOOT).unwrap()), 2).collect();
    fake.pids = Ok(vec![]);
    let later = read_snapshot(&mut fake).unwrap();
    assert!(later.processes.is_empty());
    assert_eq!(later.population, PopulationCompleteness::BestEffort);
    // No authoritative exit can be derived from this result. A future event
    // consumer needs independently qualified exit evidence before closing it.
}
#[test]
fn malformed_provider_data_fails_instead_of_becoming_unavailable() {
    for (sec, usec) in [(1, 1_000_000), (u64::MAX, 0), (18_446_744_073_709, 551_616)] {
        let mut fake = Fake::default();
        let info = fake.info.as_mut().unwrap();
        info.start_seconds = sec;
        info.start_microseconds = usec;
        assert_eq!(read_snapshot(&mut fake), Err(ContractError::InvalidBirth));
    }
    for stage in [0, 1] {
        let mut fake = Fake::default();
        fake.ids[stage] = Ok(0);
        assert_eq!(
            read_snapshot(&mut fake),
            Err(ContractError::InvalidUniqueId)
        );
    }
    let mut fake = Fake::default();
    fake.info.as_mut().unwrap().pid = 43;
    assert_eq!(read_snapshot(&mut fake), Err(ContractError::InvalidProcess));
    let mut fake = Fake::default();
    fake.ids[0] = Err(ContractError::InvalidNativeData);
    assert_eq!(
        read_snapshot(&mut fake),
        Err(ContractError::InvalidNativeData)
    );
}
#[test]
fn u64_birth_boundary_and_zero_are_preserved_without_float_conversion() {
    for (sec, usec, expected) in [(0, 0, 0), (18_446_744_073_709, 551_615, u64::MAX)] {
        let mut fake = Fake::default();
        let info = fake.info.as_mut().unwrap();
        info.start_seconds = sec;
        info.start_microseconds = usec;
        assert_eq!(observed(&mut fake).birth.unwrap().get(), expected);
    }
}
#[test]
fn boot_spelling_is_canonical_and_malformed_identity_cannot_match() {
    assert_eq!(
        BootSessionId::parse(&OTHER_BOOT.to_uppercase())
            .unwrap()
            .as_str(),
        OTHER_BOOT
    );
    for value in [
        "",
        "11111111-2222-3333-4444-55555555555z",
        "11111111-2222-3333-4444-555555555555\0",
    ] {
        assert!(BootSessionId::parse(value).is_err());
    }
    let process = observed(&mut Fake::default());
    let watch = root(&process);
    let mut changed = process.clone();
    changed.identity_error = Some("read-failed".into());
    assert!(!matches_watch_root(&changed, &watch));
    changed = process.clone();
    changed.witness = Some(Witness::Linux {
        boot_id: BOOT.into(),
        start_ticks: watch.birth,
    });
    assert!(!matches_watch_root(&changed, &watch));
}
