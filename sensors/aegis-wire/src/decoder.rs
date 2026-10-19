use crate::{Direction, MAX_FRAME_BYTES, Message, WireError, decode_payload};

/// A push reports deliveries before its first terminal error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DecodeStatus {
    pub decoded_count: usize,
    pub error_code: Option<WireError>,
    pub fatal: bool,
}

/// Incremental decoder retaining one four-byte header and advertised body.
/// Callbacks are synchronous `Result`s; Rust's exclusive borrow prevents
/// recursive calls to this same decoder and excludes async callbacks by type.
/// Returned errors and unwinding callback panics are terminal `callback-failed`.
pub struct FrameDecoder {
    direction: Direction,
    header: [u8; 4],
    header_bytes: usize,
    payload: Vec<u8>,
    expected: usize,
    error: Option<WireError>,
    closed: bool,
}
impl FrameDecoder {
    pub fn new(direction: Direction) -> Self {
        Self {
            direction,
            header: [0; 4],
            header_bytes: 0,
            payload: Vec::new(),
            expected: 0,
            error: None,
            closed: false,
        }
    }
    pub fn pending_bytes(&self) -> usize {
        self.header_bytes + self.payload.len()
    }
    pub fn is_fatal(&self) -> bool {
        self.error.is_some()
    }
    pub fn error_code(&self) -> Option<WireError> {
        self.error
    }
    fn status(&self, decoded_count: usize) -> DecodeStatus {
        DecodeStatus {
            decoded_count,
            error_code: self.error,
            fatal: self.is_fatal(),
        }
    }
    fn fail(&mut self, error: WireError) {
        self.error.get_or_insert(error);
        self.header_bytes = 0;
        self.payload = Vec::new();
        self.expected = 0;
    }
    /// Consume borrowed input without retaining or copying the whole chunk.
    pub fn push<F>(&mut self, chunk: &[u8], mut on_message: F) -> DecodeStatus
    where
        F: FnMut(Message) -> Result<(), ()>,
    {
        if self.is_fatal() {
            return self.status(0);
        }
        if self.closed {
            self.fail(WireError::DecoderClosed);
            return self.status(0);
        }
        let mut offset = 0;
        let mut count = 0;
        while offset < chunk.len() && !self.is_fatal() {
            if self.header_bytes < 4 {
                let take = (4 - self.header_bytes).min(chunk.len() - offset);
                self.header[self.header_bytes..self.header_bytes + take]
                    .copy_from_slice(&chunk[offset..offset + take]);
                self.header_bytes += take;
                offset += take;
                if self.header_bytes < 4 {
                    continue;
                }
                self.expected = u32::from_le_bytes(self.header) as usize;
                if self.expected == 0 || self.expected > MAX_FRAME_BYTES {
                    self.fail(WireError::FrameLengthInvalid);
                    break;
                }
                self.payload = Vec::with_capacity(self.expected);
            }
            let take = (self.expected - self.payload.len()).min(chunk.len() - offset);
            self.payload
                .extend_from_slice(&chunk[offset..offset + take]);
            offset += take;
            if self.payload.len() < self.expected {
                continue;
            }
            let message = match decode_payload(&self.payload, self.direction) {
                Ok(message) => message,
                Err(error) => {
                    self.fail(error);
                    break;
                }
            };
            self.header_bytes = 0;
            self.payload = Vec::new();
            self.expected = 0;
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| on_message(message)));
            if !matches!(result, Ok(Ok(()))) {
                self.fail(WireError::CallbackFailed);
                break;
            }
            count += 1;
        }
        self.status(count)
    }
    /// Mark EOF. Incomplete input fails; repeated successful EOF is idempotent.
    pub fn finish(&mut self) -> DecodeStatus {
        if !self.is_fatal() {
            if self.pending_bytes() != 0 {
                self.fail(WireError::FrameTruncated);
            } else {
                self.closed = true;
            }
        }
        self.status(0)
    }
}
