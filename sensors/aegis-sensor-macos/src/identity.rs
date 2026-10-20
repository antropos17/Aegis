use aegis_wire::{Process, WatchRoot, Witness};

/// A failed read is distinct from contradictory provider data or a boot race.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContractError {
    InvalidBootSession,
    InvalidProcess,
    InvalidBirth,
    InvalidUniqueId,
    InvalidPopulation,
    InvalidNativeData,
    BootChanged,
    Read(crate::ReadError),
}

/// Canonical wire spelling of a freshly read kernel boot-session UUID.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BootSessionId(String);

impl BootSessionId {
    /// Accept kernel hexadecimal case; reject whitespace, NUL and non-UUID data.
    /// This validates spelling, not provenance or freshness.
    pub fn parse(value: &str) -> Result<Self, ContractError> {
        if value.len() != 36
            || !value.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
        {
            return Err(ContractError::InvalidBootSession);
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Checked integer arithmetic preserves the raw sub-millisecond birth.
pub(crate) fn birth_usec(seconds: u64, microseconds: u64) -> Result<u64, ContractError> {
    if microseconds >= 1_000_000 {
        return Err(ContractError::InvalidBirth);
    }
    seconds
        .checked_mul(1_000_000)
        .and_then(|value| value.checked_add(microseconds))
        .ok_or(ContractError::InvalidBirth)
}

/// Match all identity dimensions, including raw microseconds and the boot witness.
/// Unavailable or malformed observations cannot authorize a watch root.
pub fn matches_watch_root(observed: &Process, root: &WatchRoot) -> bool {
    let Some(Witness::Darwin {
        boot_session_id,
        p_unique_id,
    }) = observed.witness.as_ref()
    else {
        return false;
    };
    observed.pid > 0
        && observed.pid <= i32::MAX as u32
        && observed.pid == root.pid
        && observed.identity_error.is_none()
        && observed.birth == Some(root.birth)
        && p_unique_id.get() > 0
        && BootSessionId::parse(boot_session_id).is_ok_and(|boot| boot.as_str() == boot_session_id)
        && observed.witness.as_ref() == Some(&root.witness)
}
