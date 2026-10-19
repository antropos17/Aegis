use aegis_wire::{Direction, FrameDecoder, decode_payload, encode_frame};
use serde::Deserialize;
use std::{fs, path::PathBuf};

#[derive(Deserialize)]
struct Case {
    name: String,
    direction: String,
    json: String,
}
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sensor-wire")
}
#[test]
fn every_shared_golden_decodes_and_encodes_byte_exactly() {
    let cases: Vec<Case> =
        serde_json::from_slice(&fs::read(fixtures().join("cases.json")).unwrap()).unwrap();
    assert_eq!(cases.len(), 27);
    for case in cases {
        let direction = match case.direction.as_str() {
            "host-to-sensor" => Direction::HostToSensor,
            "sensor-to-host" => Direction::SensorToHost,
            _ => panic!("unexpected fixture direction"),
        };
        let bytes = fs::read(fixtures().join(format!("{}.bin", case.name))).unwrap();
        assert_eq!(
            &bytes[..4],
            (case.json.len() as u32).to_le_bytes(),
            "{} length",
            case.name
        );
        assert_eq!(
            &bytes[4..],
            case.json.as_bytes(),
            "{} literal bytes",
            case.name
        );
        let message = decode_payload(&bytes[4..], direction)
            .unwrap_or_else(|error| panic!("{}: {error}", case.name));
        assert_eq!(message.direction(), direction);
        assert_eq!(
            encode_frame(&message).unwrap(),
            bytes,
            "{} re-encoding",
            case.name
        );
        for split in 0..=bytes.len() {
            let mut decoder = FrameDecoder::new(direction);
            let mut delivered = Vec::new();
            let first = decoder.push(&bytes[..split], |message| {
                delivered.push(message);
                Ok(())
            });
            let second = decoder.push(&bytes[split..], |message| {
                delivered.push(message);
                Ok(())
            });
            assert!(!first.fatal && !second.fatal, "{} split {split}", case.name);
            assert_eq!(first.decoded_count + second.decoded_count, 1);
            assert_eq!(delivered.as_slice(), std::slice::from_ref(&message));
            assert_eq!(decoder.pending_bytes(), 0);
            assert!(!decoder.finish().fatal);
        }
    }
}
