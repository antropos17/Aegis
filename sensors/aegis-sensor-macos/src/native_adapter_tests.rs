use super::*;
use crate::{Snapshot, read_snapshot};
use aegis_wire::Witness;
use std::collections::VecDeque;

const BOOT: &str = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const ID: u64 = 9_007_199_254_740_993;

#[derive(Debug)]
enum Call {
    Boot(Result<String, NativeError>),
    Pids(Result<NativePidSample, NativeError>),
    Unique(u32, Result<u64, NativeError>),
    Bsd(u32, Result<NativeBsdInfo, NativeError>),
}
struct Script(VecDeque<Call>);
impl NativeApi for Script {
    fn boot_session_id(&mut self) -> Result<String, NativeError> {
        match self.0.pop_front().expect("fresh boot read") {
            Call::Boot(value) => value,
            call => panic!("expected boot, got {call:?}"),
        }
    }
    fn list_pids(&mut self) -> Result<NativePidSample, NativeError> {
        match self.0.pop_front().expect("fresh population read") {
            Call::Pids(value) => value,
            call => panic!("expected population, got {call:?}"),
        }
    }
    fn bsd_info(&mut self, pid: u32) -> Result<NativeBsdInfo, NativeError> {
        match self.0.pop_front().expect("fresh BSD read") {
            Call::Bsd(expected, value) => {
                assert_eq!(pid, expected);
                value
            }
            call => panic!("expected BSD, got {call:?}"),
        }
    }
    fn unique_id(&mut self, pid: u32) -> Result<u64, NativeError> {
        match self.0.pop_front().expect("fresh unique-ID read") {
            Call::Unique(expected, value) => {
                assert_eq!(pid, expected);
                value
            }
            call => panic!("expected unique ID, got {call:?}"),
        }
    }
}
fn boot() -> Call {
    Call::Boot(Ok(BOOT.into()))
}
fn population(pids: Vec<u32>) -> Call {
    Call::Pids(Ok(NativePidSample {
        pids,
        completeness: aegis_macos_libproc::PopulationCompleteness::BestEffort,
    }))
}
fn info() -> NativeBsdInfo {
    NativeBsdInfo {
        pid: 42,
        ppid: 7,
        name: "owned-child".into(),
        start_seconds: 1_700_000_000,
        start_microseconds: 999_999,
    }
}
fn script(calls: Vec<Call>) -> NativeAdapter<Script> {
    NativeAdapter(Script(calls.into()))
}
fn snapshot(calls: Vec<Call>) -> Result<Snapshot, ContractError> {
    let mut adapter = script(calls);
    let result = read_snapshot(&mut adapter);
    assert!(
        adapter.0.0.is_empty(),
        "unexpected unused reads: {:?}",
        adapter.0.0
    );
    result
}
fn full_process() -> Vec<Call> {
    vec![
        boot(),
        population(vec![42]),
        Call::Unique(42, Ok(ID)),
        Call::Bsd(42, Ok(info())),
        Call::Unique(42, Ok(ID)),
        boot(),
    ]
}

#[test]
fn native_projection_uses_real_wrapper_types_and_preserves_precision_and_uncertainty() {
    let sample = snapshot(full_process()).unwrap();
    assert_eq!(sample.population, PopulationCompleteness::BestEffort);
    let process = &sample.processes[0];
    assert_eq!(
        (process.pid, process.ppid, process.name.as_str()),
        (42, 7, "owned-child")
    );
    assert_eq!(process.birth.unwrap().get(), 1_700_000_000_999_999);
    assert_eq!(
        process.witness,
        Some(Witness::Darwin {
            boot_session_id: BOOT.to_ascii_lowercase(),
            p_unique_id: aegis_wire::DecimalU64::new(ID),
        })
    );
}

#[test]
fn native_unique_id_race_cannot_emit_a_carrying_identity() {
    let mut calls = full_process();
    calls[4] = Call::Unique(42, Ok(ID + 1));
    let sample = snapshot(calls).unwrap();
    assert_eq!(sample.processes[0].birth, None);
    assert_eq!(sample.processes[0].witness, None);
    assert_eq!(
        sample.processes[0].identity_error.as_deref(),
        Some("process-gone")
    );
}

#[test]
fn real_native_errors_keep_malformed_data_separate_from_unavailable_reads() {
    for (error, expected) in [
        (
            NativeError::ReadFailed,
            ContractError::Read(ReadError::ReadFailed),
        ),
        (
            NativeError::ProcessGone,
            ContractError::Read(ReadError::ProcessGone),
        ),
        (
            NativeError::NotSupported,
            ContractError::Read(ReadError::NotSupported),
        ),
        (NativeError::InvalidData, ContractError::InvalidNativeData),
        (
            NativeError::PopulationLimit,
            ContractError::InvalidPopulation,
        ),
    ] {
        for stage in 2..=4 {
            let mut calls = full_process();
            calls[stage] = if stage == 3 {
                Call::Bsd(42, Err(error))
            } else {
                Call::Unique(42, Err(error))
            };
            calls.truncate(stage + 1);
            if let ContractError::Read(read) = expected {
                calls.push(boot());
                let sample = snapshot(calls).unwrap();
                let process = &sample.processes[0];
                assert_eq!(process.birth, None);
                assert_eq!(process.witness, None);
                assert_eq!(process.identity_error.as_deref(), Some(read.code()));
            } else {
                assert_eq!(snapshot(calls), Err(expected));
            }
        }
    }
}

#[test]
fn native_boot_failure_or_invalid_uuid_never_falls_back_to_a_generated_witness() {
    for error in [
        NativeError::ReadFailed,
        NativeError::NotSupported,
        NativeError::InvalidData,
    ] {
        assert!(snapshot(vec![Call::Boot(Err(error))]).is_err());
        let mut calls = full_process();
        calls[5] = Call::Boot(Err(error));
        assert!(snapshot(calls).is_err());
    }
    assert_eq!(
        snapshot(vec![Call::Boot(Ok("not-a-uuid".into()))]),
        Err(ContractError::InvalidBootSession)
    );
    let mut calls = full_process();
    calls[5] = Call::Boot(Ok("11111111-2222-3333-4444-555555555555".into()));
    assert_eq!(snapshot(calls), Err(ContractError::BootChanged));
}

#[test]
fn native_population_failure_never_looks_like_an_empty_success() {
    for (error, expected) in [
        (
            NativeError::ReadFailed,
            ContractError::Read(ReadError::ReadFailed),
        ),
        (NativeError::InvalidData, ContractError::InvalidNativeData),
        (
            NativeError::PopulationLimit,
            ContractError::InvalidPopulation,
        ),
    ] {
        assert_eq!(
            snapshot(vec![boot(), Call::Pids(Err(error))]),
            Err(expected)
        );
    }
}

#[test]
fn native_malformed_bytes_abort_before_final_boot_instead_of_emitting_unknown_identity() {
    let mut adapter = script(vec![
        boot(),
        population(vec![42]),
        Call::Unique(42, Ok(ID)),
        Call::Bsd(42, Err(NativeError::InvalidData)),
        boot(),
    ]);
    assert_eq!(
        read_snapshot(&mut adapter),
        Err(ContractError::InvalidNativeData)
    );
    assert_eq!(
        adapter.0.0.len(),
        1,
        "hard errors must abort before later reads"
    );
}

#[test]
fn repeated_native_samples_remain_fresh_and_cannot_infer_exit_from_absence() {
    let mut calls = full_process();
    calls.extend([boot(), population(vec![]), boot()]);
    let mut adapter = script(calls);
    let first = read_snapshot(&mut adapter).unwrap();
    let second = read_snapshot(&mut adapter).unwrap();
    assert_eq!(first.processes.len(), 1);
    assert!(second.processes.is_empty());
    assert_eq!(first.population, PopulationCompleteness::BestEffort);
    assert_eq!(second.population, PopulationCompleteness::BestEffort);
    assert!(adapter.0.0.is_empty());
}

#[test]
fn a_later_native_read_failure_cannot_reuse_the_prior_birth() {
    let mut calls = full_process();
    calls.extend([
        boot(),
        population(vec![42]),
        Call::Unique(42, Err(NativeError::ReadFailed)),
        boot(),
    ]);
    let mut adapter = script(calls);
    assert!(
        read_snapshot(&mut adapter).unwrap().processes[0]
            .birth
            .is_some()
    );
    let later = read_snapshot(&mut adapter).unwrap();
    assert_eq!(later.processes[0].birth, None);
    assert_eq!(later.processes[0].witness, None);
    assert_eq!(later.population, PopulationCompleteness::BestEffort);
    assert!(adapter.0.0.is_empty());
}
