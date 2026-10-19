use crate::{DecimalU64, Witness};
use serde::{Deserialize, Serialize};

/// Events serialize common fields in JS projection order, then kind fields.
/// Fields remain public for sensor producers; `encode_frame` validates them.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Event {
    Exec {
        #[serde(flatten)]
        common: EventCommon,
        exe: String,
        argc: u32,
    },
    Open {
        #[serde(flatten)]
        common: EventCommon,
        path: String,
        access: String,
    },
    Connect {
        #[serde(flatten)]
        common: EventCommon,
        family: u8,
        daddr: String,
        dport: u16,
        saddr: String,
        sport: u16,
    },
    Fork {
        #[serde(flatten)]
        common: EventCommon,
    },
    Exit {
        #[serde(flatten)]
        common: EventCommon,
    },
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventCommon {
    pub seq: DecimalU64,
    pub pid: u32,
    pub ppid: u32,
    pub birth: Option<DecimalU64>,
    pub witness: Option<Witness>,
    pub identity_error: Option<String>,
    pub ts: DecimalU64,
}
impl Event {
    pub fn common(&self) -> &EventCommon {
        match self {
            Self::Exec { common, .. }
            | Self::Open { common, .. }
            | Self::Connect { common, .. }
            | Self::Fork { common }
            | Self::Exit { common } => common,
        }
    }
}
impl Serialize for Event {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(None)?;
        let kind = match self {
            Self::Exec { .. } => "exec",
            Self::Open { .. } => "open",
            Self::Connect { .. } => "connect",
            Self::Fork { .. } => "fork",
            Self::Exit { .. } => "exit",
        };
        let common = self.common();
        map.serialize_entry("seq", &common.seq)?;
        map.serialize_entry("kind", kind)?;
        map.serialize_entry("pid", &common.pid)?;
        map.serialize_entry("ppid", &common.ppid)?;
        map.serialize_entry("birth", &common.birth)?;
        map.serialize_entry("witness", &common.witness)?;
        map.serialize_entry("identityError", &common.identity_error)?;
        map.serialize_entry("ts", &common.ts)?;
        match self {
            Self::Exec { exe, argc, .. } => {
                map.serialize_entry("exe", exe)?;
                map.serialize_entry("argc", argc)?;
            }
            Self::Open { path, access, .. } => {
                map.serialize_entry("path", path)?;
                map.serialize_entry("access", access)?;
            }
            Self::Connect {
                family,
                daddr,
                dport,
                saddr,
                sport,
                ..
            } => {
                map.serialize_entry("family", family)?;
                map.serialize_entry("daddr", daddr)?;
                map.serialize_entry("dport", dport)?;
                map.serialize_entry("saddr", saddr)?;
                map.serialize_entry("sport", sport)?;
            }
            _ => {}
        }
        map.end()
    }
}
