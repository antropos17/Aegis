#![allow(dead_code)]
use aegis_wire::{Direction, Message, WireError, decode_payload};
use serde_json::Value;
pub const H: Direction = Direction::HostToSensor;
pub const S: Direction = Direction::SensorToHost;
pub fn cases() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/sensor-wire/cases.json"
    ))
    .unwrap()
}
pub fn fixture(name: &str) -> Value {
    let entry = cases()
        .into_iter()
        .find(|entry| entry["name"] == name)
        .unwrap();
    serde_json::from_str(entry["json"].as_str().unwrap()).unwrap()
}
pub fn decode(value: &Value, direction: Direction) -> Result<Message, WireError> {
    decode_payload(&serde_json::to_vec(value).unwrap(), direction)
}
pub fn invalid(value: &Value, direction: Direction) {
    assert_eq!(decode(value, direction), Err(WireError::MessageInvalid));
}
pub fn frame(payload: impl AsRef<[u8]>) -> Vec<u8> {
    let payload = payload.as_ref();
    let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(payload);
    bytes
}
