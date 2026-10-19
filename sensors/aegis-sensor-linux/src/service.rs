use crate::procfs::read_boot;
use crate::{ProcfsSource, SnapshotError, parse_stat, snapshot};
use aegis_wire::{
    Capabilities, ClockAnchor, Direction, HostMessage, LinuxVersions, MAX_FRAME_BYTES, Message,
    SensorMessage, Versions, WatchRoot, WireError, Witness, decode_payload, encode_frame,
};
use std::io::{Read, Write};

/// Errors contain fixed vocabulary only. The binary never prints peer metadata.
#[derive(Debug, Eq, PartialEq)]
pub enum ServeError {
    ReadFailed,
    WriteFailed,
    Wire(WireError),
}
impl ServeError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::ReadFailed => "read-failed",
            Self::WriteFailed => "write-failed",
            Self::Wire(error) => error.code(),
        }
    }
}

/// Only snapshots are observed in this delivery; no lifecycle event is promised.
pub fn capabilities() -> Capabilities {
    Capabilities {
        exec: false,
        exit: false,
        fork: false,
        file_open: false,
        tcp_connect: false,
        identity: "procfs-ticks".into(),
        witness: "boot-id".into(),
    }
}

/// Explicit identity/version inputs permit Windows fixture tests without claiming
/// a native Linux clock or kernel. The real entrypoint supplies OS observations.
pub struct Hello {
    pub pid: u32,
    pub kernel: String,
    pub clock_anchor: ClockAnchor,
}

/// A bounded blocking stdin/stdout service. EOF ends cleanly between frames;
/// malformed/truncated input terminates. Each reply is flushed before the next
/// request, preventing deadlock with hosts that wait for acknowledgements.
pub fn serve(
    source: &mut impl ProcfsSource,
    reader: &mut impl Read,
    writer: &mut impl Write,
    hello: Hello,
) -> Result<(), ServeError> {
    emit(
        writer,
        SensorMessage::Hello {
            proto: "sensor/1".into(),
            platform: "linux".into(),
            mode: "procfs".into(),
            modes: vec!["procfs".into()],
            caps: capabilities(),
            pid: hello.pid,
            versions: Versions::Linux(LinuxVersions {
                sensor: env!("CARGO_PKG_VERSION").into(),
                kernel: hello.kernel,
                clock_anchor: hello.clock_anchor,
            }),
        },
    )?;
    health(writer, "STARTING", "starting")?;
    let mut watches = Vec::new();
    while let Some(request) = read_request(reader)? {
        let response = match request {
            HostMessage::Snap { id } => match snapshot(source) {
                Ok(procs) => {
                    emit(writer, SensorMessage::Snap { id, procs })?;
                    health(writer, "HEALTHY", "ready")?;
                    continue;
                }
                Err(error) => {
                    emit(
                        writer,
                        SensorMessage::Err {
                            id,
                            code: error.code().into(),
                        },
                    )?;
                    health(writer, "FAILED", "read-failed")?;
                    continue;
                }
            },
            HostMessage::Watch { id, roots, .. } => {
                match replace_watches(source, &mut watches, roots) {
                    Ok(()) => SensorMessage::Ack { id },
                    Err(code) => SensorMessage::Err {
                        id,
                        code: code.into(),
                    },
                }
            }
            HostMessage::Paths { id, .. } => SensorMessage::Err {
                id,
                code: "unsupported".into(),
            },
            HostMessage::Stop { id } => {
                emit(writer, SensorMessage::Ack { id })?;
                return Ok(());
            }
        };
        emit(writer, response)?;
    }
    Ok(())
}

fn replace_watches(
    source: &mut impl ProcfsSource,
    watches: &mut Vec<WatchRoot>,
    roots: Vec<WatchRoot>,
) -> Result<(), &'static str> {
    let boot = read_boot(source).map_err(SnapshotError::code)?;
    for root in &roots {
        let bytes = source.stat(root.pid).map_err(|error| {
            if crate::procfs::gone(&error) {
                "root-mismatch"
            } else {
                "read-failed"
            }
        })?;
        let stat = parse_stat(&bytes, root.pid).map_err(SnapshotError::code)?;
        if root.birth.get() != stat.ticks
            || root.witness
                != (Witness::Linux {
                    boot_id: boot.clone(),
                    start_ticks: root.birth,
                })
        {
            return Err("root-mismatch");
        }
    }
    if read_boot(source).map_err(SnapshotError::code)? != boot {
        return Err("read-failed");
    }
    *watches = roots;
    Ok(())
}

fn emit(writer: &mut impl Write, message: SensorMessage) -> Result<(), ServeError> {
    let bytes = encode_frame(&message.into()).map_err(ServeError::Wire)?;
    writer
        .write_all(&bytes)
        .and_then(|()| writer.flush())
        .map_err(|_| ServeError::WriteFailed)
}

fn health(writer: &mut impl Write, state: &str, detail: &str) -> Result<(), ServeError> {
    emit(
        writer,
        SensorMessage::Health {
            state: state.into(),
            detail: detail.into(),
        },
    )
}

fn read_request(reader: &mut impl Read) -> Result<Option<HostMessage>, ServeError> {
    let mut header = [0; 4];
    // Read::read_exact cannot distinguish clean EOF from a partial frame header.
    loop {
        match reader.read(&mut header[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(ServeError::ReadFailed),
        }
    }
    read_exact(reader, &mut header[1..])?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(ServeError::Wire(WireError::FrameLengthInvalid));
    }
    let mut body = vec![0; length];
    read_exact(reader, &mut body)?;
    match decode_payload(&body, Direction::HostToSensor).map_err(ServeError::Wire)? {
        Message::Host(request) => Ok(Some(request)),
        Message::Sensor(_) => Err(ServeError::Wire(WireError::MessageInvalid)),
    }
}

fn read_exact(reader: &mut impl Read, bytes: &mut [u8]) -> Result<(), ServeError> {
    reader.read_exact(bytes).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            ServeError::Wire(WireError::FrameTruncated)
        } else {
            ServeError::ReadFailed
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aegis_wire::DecimalU64;
    use std::io;

    struct Source {
        ticks: u64,
    }
    impl ProcfsSource for Source {
        fn boot_id(&mut self) -> io::Result<String> {
            Ok("11111111-1111-4111-8111-111111111111".into())
        }
        fn pids(&mut self) -> io::Result<Vec<u32>> {
            Ok(vec![42])
        }
        fn stat(&mut self, pid: u32) -> io::Result<Vec<u8>> {
            Ok(format!(
                "{pid} (worker) S 1 {} {}",
                vec!["0"; 17].join(" "),
                self.ticks
            )
            .into_bytes())
        }
    }
    fn root(pid: u32, ticks: u64) -> WatchRoot {
        WatchRoot {
            pid,
            birth: DecimalU64::new(ticks),
            witness: Witness::Linux {
                boot_id: "11111111-1111-4111-8111-111111111111".into(),
                start_ticks: DecimalU64::new(ticks),
            },
        }
    }
    #[test]
    fn replacement_is_atomic_when_later_root_fails() {
        let mut source = Source { ticks: 10 };
        let mut watches = vec![];
        replace_watches(&mut source, &mut watches, vec![root(42, 10)]).unwrap();
        source.ticks = 20;
        assert_eq!(
            replace_watches(&mut source, &mut watches, vec![root(42, 20), root(43, 21)]),
            Err("root-mismatch")
        );
        assert_eq!(watches, vec![root(42, 10)]);
    }
}
