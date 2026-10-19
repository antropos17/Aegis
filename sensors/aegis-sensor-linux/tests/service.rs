use aegis_sensor_linux::{Hello, ProcfsSource, ServeError, serve};
use aegis_wire::{
    ClockAnchor, DecimalU64, Direction, HostMessage, Message, SensorMessage, WatchRoot, WireError,
    Witness, decode_payload, encode_frame,
};
use std::collections::VecDeque;
use std::io;

const BOOT: &str = "11111111-1111-4111-8111-111111111111";
struct Source {
    outcomes: VecDeque<io::Result<Vec<u8>>>,
}
impl ProcfsSource for Source {
    fn boot_id(&mut self) -> io::Result<String> {
        Ok(BOOT.into())
    }
    fn pids(&mut self) -> io::Result<Vec<u32>> {
        Ok(vec![42])
    }
    fn stat(&mut self, _: u32) -> io::Result<Vec<u8>> {
        self.outcomes.pop_front().unwrap()
    }
}
fn row(ticks: &str) -> io::Result<Vec<u8>> {
    Ok(format!("42 (node) S 1 {} {ticks}\n", vec!["0"; 17].join(" ")).into_bytes())
}
fn hello() -> Hello {
    Hello {
        pid: 100,
        kernel: "fixture-kernel".into(),
        clock_anchor: ClockAnchor {
            clock: "boottime".into(),
            monotonic_usec: DecimalU64::new(100),
            unix_usec: DecimalU64::new(500),
        },
    }
}
fn requests(requests: Vec<HostMessage>) -> Vec<u8> {
    requests
        .into_iter()
        .flat_map(|request| encode_frame(&request.into()).unwrap())
        .collect()
}
fn decode(mut bytes: &[u8]) -> Vec<SensorMessage> {
    let mut messages = vec![];
    while !bytes.is_empty() {
        let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let message = decode_payload(&bytes[4..4 + length], Direction::SensorToHost).unwrap();
        let Message::Sensor(message) = message else {
            panic!("wrong direction")
        };
        messages.push(*message);
        bytes = &bytes[4 + length..];
    }
    messages
}

#[test]
fn wire_path_is_hello_first_exact_snapshot_outage_recovery_and_stop() {
    struct Fragmented<'a>(&'a [u8]);
    impl io::Read for Fragmented<'_> {
        fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
            let count = output.len().min(1);
            io::Read::read(&mut self.0, &mut output[..count])
        }
    }
    let mut source = Source {
        outcomes: [
            row("9007199254740993"),
            Err(io::ErrorKind::PermissionDenied.into()),
            row("9007199254740994"),
        ]
        .into(),
    };
    let input = requests(vec![
        HostMessage::Snap { id: 1 },
        HostMessage::Snap { id: 2 },
        HostMessage::Snap { id: 3 },
        HostMessage::Stop { id: 4 },
        HostMessage::Snap { id: 5 },
    ]);
    let mut output = vec![];
    serve(&mut source, &mut Fragmented(&input), &mut output, hello()).unwrap();
    let messages = decode(&output);
    let SensorMessage::Hello {
        mode, modes, caps, ..
    } = &messages[0]
    else {
        panic!("hello first")
    };
    assert_eq!(mode, "procfs");
    assert_eq!(modes, &["procfs"]);
    assert!(!caps.exec && !caps.exit && !caps.fork && !caps.file_open && !caps.tcp_connect);
    assert_eq!(caps.identity, "procfs-ticks");
    assert_eq!(caps.witness, "boot-id");
    let snapshots: Vec<_> = messages
        .iter()
        .filter_map(|message| {
            if let SensorMessage::Snap { id, procs } = message {
                Some((*id, procs))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0].0, 1);
    assert_eq!(snapshots[1].0, 3);
    assert_eq!(
        snapshots[0].1[0].birth,
        Some(DecimalU64::new(9_007_199_254_740_993))
    );
    assert_eq!(
        snapshots[1].1[0].birth,
        Some(DecimalU64::new(9_007_199_254_740_994))
    );
    assert!(messages.contains(&SensorMessage::Err {
        id: 2,
        code: "read-failed".into()
    }));
    assert!(messages.contains(&SensorMessage::Health {
        state: "FAILED".into(),
        detail: "read-failed".into()
    }));
    assert_eq!(messages.last(), Some(&SensorMessage::Ack { id: 4 }));
}

#[test]
fn unsupported_paths_receive_error_and_no_success_ack() {
    let input = requests(vec![HostMessage::Paths {
        id: 8,
        prefixes: vec!["/sensitive".into()],
    }]);
    let mut output = vec![];
    serve(
        &mut Source {
            outcomes: vec![].into(),
        },
        &mut input.as_slice(),
        &mut output,
        hello(),
    )
    .unwrap();
    assert_eq!(
        decode(&output).last(),
        Some(&SensorMessage::Err {
            id: 8,
            code: "unsupported".into()
        })
    );
}

#[test]
fn watch_root_checks_fresh_raw_birth_and_boot_witness() {
    let root = |ticks, boot: &str| WatchRoot {
        pid: 42,
        birth: DecimalU64::new(ticks),
        witness: Witness::Linux {
            boot_id: boot.into(),
            start_ticks: DecimalU64::new(ticks),
        },
    };
    let input = requests(vec![
        HostMessage::Watch {
            id: 1,
            roots: vec![root(123, BOOT)],
            descendants: true,
        },
        HostMessage::Watch {
            id: 2,
            roots: vec![root(123, BOOT)],
            descendants: true,
        },
        HostMessage::Watch {
            id: 3,
            roots: vec![root(124, "22222222-2222-4222-8222-222222222222")],
            descendants: true,
        },
    ]);
    let mut source = Source {
        outcomes: [row("123"), row("124"), row("124")].into(),
    };
    let mut output = vec![];
    serve(&mut source, &mut input.as_slice(), &mut output, hello()).unwrap();
    assert_eq!(
        &decode(&output)[2..],
        &[
            SensorMessage::Ack { id: 1 },
            SensorMessage::Err {
                id: 2,
                code: "root-mismatch".into()
            },
            SensorMessage::Err {
                id: 3,
                code: "root-mismatch".into()
            },
        ]
    );
}

#[test]
fn partial_header_body_duplicate_keys_and_oversize_terminate() {
    for (input, expected) in [
        (vec![1], WireError::FrameTruncated),
        (vec![2, 0, 0, 0, b'{'], WireError::FrameTruncated),
        (vec![0, 0, 0, 0], WireError::FrameLengthInvalid),
        (
            (8_388_609_u32).to_le_bytes().to_vec(),
            WireError::FrameLengthInvalid,
        ),
        (
            {
                let body = br#"{"t":"snap","id":1,"id":2}"#;
                let mut frame = (body.len() as u32).to_le_bytes().to_vec();
                frame.extend_from_slice(body);
                frame
            },
            WireError::JsonInvalid,
        ),
    ] {
        let mut output = vec![];
        assert_eq!(
            serve(
                &mut Source {
                    outcomes: vec![].into()
                },
                &mut input.as_slice(),
                &mut output,
                hello()
            ),
            Err(ServeError::Wire(expected))
        );
        assert_eq!(decode(&output).len(), 2); // hello + starting; never a request reply
    }
}

#[test]
fn replies_flush_and_broken_stdout_fails_closed() {
    #[derive(Default)]
    struct Tracked {
        bytes: Vec<u8>,
        flushes: usize,
    }
    impl io::Write for Tracked {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.flushes += 1;
            Ok(())
        }
    }
    let mut tracked = Tracked::default();
    let input = requests(vec![HostMessage::Stop { id: 1 }]);
    serve(
        &mut Source {
            outcomes: vec![].into(),
        },
        &mut input.as_slice(),
        &mut tracked,
        hello(),
    )
    .unwrap();
    assert_eq!(decode(&tracked.bytes).len(), 3);
    assert_eq!(tracked.flushes, 3);
    struct Broken;
    impl io::Write for Broken {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> io::Result<()> {
            panic!("must not flush after failed write")
        }
    }
    assert_eq!(
        serve(
            &mut Source {
                outcomes: vec![].into()
            },
            &mut [].as_slice(),
            &mut Broken,
            hello()
        ),
        Err(ServeError::WriteFailed)
    );
}
