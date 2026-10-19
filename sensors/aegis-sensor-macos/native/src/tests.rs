use crate::{NativeError, reads::*};
use std::mem::{offset_of, size_of};

#[repr(C)]
struct BsdLayout {
    words: [u32; 12],
    comm: [u8; 16],
    name: [u8; 32],
    tail: [u32; 6],
    seconds: u64,
    microseconds: u64,
}
#[repr(C)]
struct UniqueLayout {
    uuid: [u8; 16],
    unique: u64,
    parent_unique: u64,
    version: i32,
    parent_version: i32,
    reserved: [u64; 2],
}

#[test]
fn portable_layout_matches_recorded_64_bit_offsets() {
    assert_eq!(size_of::<BsdLayout>(), BSD_SIZE);
    assert_eq!(offset_of!(BsdLayout, comm), 48);
    assert_eq!(offset_of!(BsdLayout, name), 64);
    assert_eq!(offset_of!(BsdLayout, seconds), 120);
    assert_eq!(offset_of!(BsdLayout, microseconds), 128);
    assert_eq!(size_of::<UniqueLayout>(), UNIQUE_SIZE);
    assert_eq!(offset_of!(UniqueLayout, unique), 16);
}

struct Fake {
    bytes: Vec<u8>,
    returned: usize,
    error: Option<NativeError>,
    calls: Vec<(i32, i32)>,
}
impl Fake {
    fn data(bytes: Vec<u8>) -> Self {
        Self {
            returned: bytes.len(),
            bytes,
            error: None,
            calls: vec![],
        }
    }
    fn fill(&self, out: &mut [u8]) -> Result<usize, NativeError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        let size = self.bytes.len().min(out.len());
        out[..size].copy_from_slice(&self.bytes[..size]);
        Ok(self.returned)
    }
}
impl Backend for Fake {
    fn pidinfo(&mut self, pid: i32, flavor: i32, out: &mut [u8]) -> Result<usize, NativeError> {
        self.calls.push((pid, flavor));
        self.fill(out)
    }
    fn listpids(&mut self, out: &mut [u8]) -> Result<usize, NativeError> {
        self.fill(out)
    }
    fn boot_uuid(&mut self, out: &mut [u8]) -> Result<usize, NativeError> {
        self.fill(out)
    }
}
fn bsd() -> Vec<u8> {
    let mut bytes = vec![0; BSD_SIZE];
    bytes[12..16].copy_from_slice(&42u32.to_ne_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_ne_bytes());
    bytes[48..52].copy_from_slice(b"node");
    bytes[120..128].copy_from_slice(&1_700_000_000u64.to_ne_bytes());
    bytes[128..136].copy_from_slice(&999_999u64.to_ne_bytes());
    bytes
}

#[test]
fn exact_bsd_preserves_birth_and_uses_comm_when_name_empty() {
    let mut fake = Fake::data(bsd());
    let info = bsd_info(&mut fake, 42).unwrap();
    assert_eq!(info.name, "node");
    assert_eq!(info.start_seconds, 1_700_000_000);
    assert_eq!(info.start_microseconds, 999_999);
    assert_eq!(fake.calls, [(42, 3)]);
}
#[test]
fn name_is_bounded_even_without_terminator_and_prefers_registered_name() {
    let mut bytes = bsd();
    bytes[64..96].fill(b'x');
    assert_eq!(
        bsd_info(&mut Fake::data(bytes), 42).unwrap().name,
        "x".repeat(32)
    );
}
#[test]
fn all_short_or_overlong_struct_reads_fail() {
    for size in [0, 1, BSD_SIZE - 1, BSD_SIZE + 1, usize::MAX] {
        let mut fake = Fake::data(bsd());
        fake.returned = size;
        assert_eq!(bsd_info(&mut fake, 42), Err(NativeError::InvalidData));
    }
    for size in [0, 1, UNIQUE_SIZE - 1, UNIQUE_SIZE + 1, usize::MAX] {
        let mut fake = Fake::data(vec![1; UNIQUE_SIZE]);
        fake.returned = size;
        assert_eq!(unique_id(&mut fake, 42), Err(NativeError::InvalidData));
    }
}
#[test]
fn invalid_pid_arguments_never_reach_backend() {
    for pid in [0, i32::MAX as u32 + 1, u32::MAX] {
        let mut fake = Fake::data(bsd());
        assert_eq!(bsd_info(&mut fake, pid), Err(NativeError::InvalidData));
        assert_eq!(unique_id(&mut fake, pid), Err(NativeError::InvalidData));
        assert!(fake.calls.is_empty());
    }
}
#[test]
fn bsd_wrong_pid_invalid_time_and_bad_utf8_fail_closed() {
    for (offset, data) in [
        (12, 43u32.to_ne_bytes().to_vec()),
        (16, u32::MAX.to_ne_bytes().to_vec()),
        (120, u64::MAX.to_ne_bytes().to_vec()),
        (128, 1_000_000u64.to_ne_bytes().to_vec()),
        (64, vec![0xff]),
    ] {
        let mut bytes = bsd();
        bytes[offset..offset + data.len()].copy_from_slice(&data);
        assert_eq!(
            bsd_info(&mut Fake::data(bytes), 42),
            Err(NativeError::InvalidData)
        );
    }
}
#[test]
fn unique_id_preserves_u64_max_and_rejects_zero() {
    let mut bytes = vec![0; UNIQUE_SIZE];
    assert_eq!(
        unique_id(&mut Fake::data(bytes.clone()), 42),
        Err(NativeError::InvalidData)
    );
    bytes[16..24].copy_from_slice(&u64::MAX.to_ne_bytes());
    let mut fake = Fake::data(bytes);
    assert_eq!(unique_id(&mut fake, 42), Ok(u64::MAX));
    assert_eq!(fake.calls, [(42, 17)]);
}
#[test]
fn boot_uuid_requires_exact_terminated_value_and_normalizes_case() {
    let uuid = b"AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE\0".to_vec();
    assert_eq!(
        boot_session_id(&mut Fake::data(uuid.clone())),
        Ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into())
    );
    for size in [0, 36, 38, usize::MAX] {
        let mut fake = Fake::data(uuid.clone());
        fake.returned = size;
        assert_eq!(boot_session_id(&mut fake), Err(NativeError::InvalidData));
    }
    for index in [0, 8, 35, 36] {
        let mut bytes = uuid.clone();
        bytes[index] = b'!';
        assert_eq!(
            boot_session_id(&mut Fake::data(bytes)),
            Err(NativeError::InvalidData)
        );
    }
}
#[test]
fn population_skips_kernel_pid_and_rejects_truncation_duplicates_and_invalid_pids() {
    let bytes = [0u32, 42, 99]
        .into_iter()
        .flat_map(u32::to_ne_bytes)
        .collect();
    assert_eq!(
        list_pids(&mut Fake::data(bytes)),
        Ok(PidSample {
            pids: vec![42, 99],
            completeness: PopulationCompleteness::BestEffort,
        })
    );
    for size in [0, 1, 3, (PID_LIMIT + 1) * 4, usize::MAX] {
        let mut fake = Fake::data(vec![0; 4]);
        fake.returned = size;
        assert!(list_pids(&mut fake).is_err());
    }
    for pids in [[42u32, 42], [42, u32::MAX]] {
        let bytes = pids.into_iter().flat_map(u32::to_ne_bytes).collect();
        assert_eq!(
            list_pids(&mut Fake::data(bytes)),
            Err(NativeError::InvalidData)
        );
    }
}

#[test]
fn underfilled_population_is_always_explicitly_best_effort() {
    let bytes = 42u32.to_ne_bytes().to_vec();
    let sample = list_pids(&mut Fake::data(bytes)).unwrap();
    assert_eq!(sample.pids, vec![42]);
    assert_eq!(sample.completeness, PopulationCompleteness::BestEffort);
    // The same underfilled byte response could represent a stable population
    // or a kernel internal allocation race; the API cannot distinguish them.
    let kernel_only = list_pids(&mut Fake::data(0u32.to_ne_bytes().to_vec())).unwrap();
    assert!(kernel_only.pids.is_empty());
    assert_eq!(kernel_only.completeness, PopulationCompleteness::BestEffort);
}
#[test]
fn backend_errors_are_preserved_without_default_data() {
    for error in [
        NativeError::ReadFailed,
        NativeError::ProcessGone,
        NativeError::NotSupported,
    ] {
        let mut fake = Fake::data(bsd());
        fake.error = Some(error);
        assert_eq!(bsd_info(&mut fake, 42), Err(error));
        assert_eq!(unique_id(&mut fake, 42), Err(error));
        assert_eq!(boot_session_id(&mut fake), Err(error));
        assert_eq!(list_pids(&mut fake), Err(error));
    }
}
