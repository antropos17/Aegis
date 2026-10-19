use crate::{Direction, Event, WireError};
use serde::{Deserialize, Serialize};

/// An owned message whose direction is explicit even for the two `snap` shapes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Message {
    Host(HostMessage),
    Sensor(Box<SensorMessage>),
}
impl Message {
    pub const fn direction(&self) -> Direction {
        match self {
            Self::Host(_) => Direction::HostToSensor,
            Self::Sensor(_) => Direction::SensorToHost,
        }
    }
}

/// Canonical u64 decimal string. Numeric wire fields use JSON integers instead.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct DecimalU64(u64);
impl DecimalU64 {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
}
impl Serialize for DecimalU64 {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}
impl<'de> Deserialize<'de> for DecimalU64 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        parse_decimal(&text)
            .map(Self)
            .ok_or_else(|| serde::de::Error::custom("message-invalid"))
    }
}
pub(crate) fn parse_decimal(value: &str) -> Option<u64> {
    if value.is_empty()
        || value.len() > 20
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}
impl std::str::FromStr for DecimalU64 {
    type Err = WireError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_decimal(value)
            .map(Self)
            .ok_or(WireError::MessageInvalid)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostMessage {
    Watch {
        id: u32,
        roots: Vec<WatchRoot>,
        descendants: bool,
    },
    Paths {
        id: u32,
        prefixes: Vec<String>,
    },
    Snap {
        id: u32,
    },
    Stop {
        id: u32,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SensorMessage {
    Hello {
        proto: String,
        platform: String,
        mode: String,
        modes: Vec<String>,
        caps: Capabilities,
        versions: Versions,
        pid: u32,
    },
    Mode {
        mode: String,
        caps: Capabilities,
        reason: String,
        seq: DecimalU64,
    },
    Evs {
        from: DecimalU64,
        to: DecimalU64,
        events: Vec<Event>,
    },
    Loss {
        from: DecimalU64,
        to: DecimalU64,
        count: DecimalU64,
        reason: String,
    },
    Snap {
        id: u32,
        procs: Vec<Process>,
    },
    Health {
        state: String,
        detail: String,
    },
    Err {
        id: u32,
        code: String,
    },
    Ack {
        id: u32,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub exec: bool,
    pub exit: bool,
    pub fork: bool,
    pub file_open: bool,
    pub tcp_connect: bool,
    pub identity: String,
    pub witness: String,
}

/// Linux and Darwin versions have distinct exact shapes.
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(untagged)]
pub enum Versions {
    Linux(LinuxVersions),
    Darwin(DarwinVersions),
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinuxVersions {
    pub sensor: String,
    pub kernel: String,
    pub clock_anchor: ClockAnchor,
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DarwinVersions {
    pub sensor: String,
    pub os: String,
    pub clock_anchor: ClockAnchor,
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockAnchor {
    pub clock: String,
    pub monotonic_usec: DecimalU64,
    pub unix_usec: DecimalU64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum Witness {
    #[serde(rename = "linux-start-ticks")]
    Linux {
        #[serde(rename = "bootId")]
        boot_id: String,
        #[serde(rename = "startTicks")]
        start_ticks: DecimalU64,
    },
    #[serde(rename = "macos-unique-id")]
    Darwin {
        #[serde(rename = "bootSessionId")]
        boot_session_id: String,
        #[serde(rename = "pUniqueId")]
        p_unique_id: DecimalU64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Process {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub birth: Option<DecimalU64>,
    pub witness: Option<Witness>,
    pub identity_error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WatchRoot {
    pub pid: u32,
    pub birth: DecimalU64,
    pub witness: Witness,
}

impl From<HostMessage> for Message {
    fn from(value: HostMessage) -> Self {
        Self::Host(value)
    }
}
impl From<SensorMessage> for Message {
    fn from(value: SensorMessage) -> Self {
        Self::Sensor(Box::new(value))
    }
}
