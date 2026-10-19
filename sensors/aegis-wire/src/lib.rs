//! Pure `sensor/1` wire types and bounded framing. No OS or session state.
//!
//! The caller owns transport custody, hello-first/once, active capabilities,
//! request correlation and cross-frame sequence continuity.
mod decoder;
mod events;
mod json;
mod observations;
mod schema;
mod types;

pub use decoder::{DecodeStatus, FrameDecoder};
pub use events::{Event, EventCommon};
pub use types::*;

/// Largest advertised JSON body, excluding the four-byte header.
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

/// Selects one closed message vocabulary; snapshot requests and replies differ.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    HostToSensor,
    SensorToHost,
}

/// Fixed errors never include peer metadata or callback exception text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WireError {
    MessageInvalid,
    ProtocolUnsupported,
    FrameLengthInvalid,
    Utf8Invalid,
    JsonInvalid,
    FrameTruncated,
    CallbackFailed,
    DecoderClosed,
}

impl WireError {
    /// Stable error vocabulary shared with the JavaScript codec.
    pub const fn code(self) -> &'static str {
        match self {
            Self::MessageInvalid => "message-invalid",
            Self::ProtocolUnsupported => "protocol-unsupported",
            Self::FrameLengthInvalid => "frame-length-invalid",
            Self::Utf8Invalid => "utf8-invalid",
            Self::JsonInvalid => "json-invalid",
            Self::FrameTruncated => "frame-truncated",
            Self::CallbackFailed => "callback-failed",
            Self::DecoderClosed => "decoder-closed",
        }
    }
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for WireError {}

/// Validate an arbitrary UTF-8 JSON body and return owned directional types.
/// Duplicate keys, noncanonical number tokens and depth are checked before schema.
pub fn decode_payload(payload: &[u8], direction: Direction) -> Result<Message, WireError> {
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        return Err(WireError::FrameLengthInvalid);
    }
    let value = json::parse(payload)?;
    schema::validate(&value, direction)?;
    match direction {
        Direction::HostToSensor => serde_json::from_value(value).map(Message::Host),
        Direction::SensorToHost => {
            serde_json::from_value::<SensorMessage>(value).map(Message::from)
        }
    }
    .map_err(|_| WireError::MessageInvalid)
}

/// Encode compact canonical JSON in the same field order as the JS projection.
/// Public typed fields are validated again; constructing a struct cannot bypass
/// identity consistency, finite limits, direction or the closed vocabulary.
pub fn encode_frame(message: &Message) -> Result<Vec<u8>, WireError> {
    let mut output = BoundedPayload::default();
    let result = match message {
        Message::Host(value) => serde_json::to_writer(&mut output, value),
        Message::Sensor(value) => serde_json::to_writer(&mut output, value),
    };
    if output.exceeded {
        return Err(WireError::FrameLengthInvalid);
    }
    result.map_err(|_| WireError::MessageInvalid)?;
    let payload = output.bytes;
    decode_payload(&payload, message.direction())?;
    let length = u32::try_from(payload.len()).map_err(|_| WireError::FrameLengthInvalid)?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&length.to_le_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

#[derive(Default)]
struct BoundedPayload {
    bytes: Vec<u8>,
    exceeded: bool,
}
impl std::io::Write for BoundedPayload {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_FRAME_BYTES - self.bytes.len() {
            self.exceeded = true;
            return Err(std::io::Error::other("frame-length-invalid"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn encoder_writer_refuses_overflow_without_retaining_partial_output() {
        let mut output = BoundedPayload::default();
        output.write_all(&vec![b'x'; 8_388_607]).unwrap();
        assert!(output.write_all(b"xx").is_err());
        assert!(output.exceeded);
        assert_eq!(output.bytes.len(), 8_388_607);
    }
}
