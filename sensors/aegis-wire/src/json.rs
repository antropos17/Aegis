//! Strict JSON admission before any schema or typed deserialization.
use crate::WireError;
use serde_json::{Map, Value};

// The largest legal object is a 13-field connect event; arrays allow 4096.
// The densest legal frame is 4096 connect events with available witnesses:
// 9 batch nodes + 4096 * 33 event nodes = 135177, counting object keys.
const MAX_ARRAY_ENTRIES: usize = 4096;
const MAX_OBJECT_KEYS: usize = 16;
const MAX_STRUCTURE_NODES: usize = 140_000;

pub(crate) fn parse(payload: &[u8]) -> Result<Value, WireError> {
    if payload.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(WireError::Utf8Invalid);
    }
    let source = std::str::from_utf8(payload).map_err(|_| WireError::Utf8Invalid)?;
    let mut parser = Parser {
        source,
        offset: 0,
        nodes: 0,
    };
    let value = parser.value(0)?;
    parser.whitespace();
    if parser.offset != source.len() {
        return Err(WireError::JsonInvalid);
    }
    Ok(value)
}
struct Parser<'a> {
    source: &'a str,
    offset: usize,
    nodes: usize,
}
impl Parser<'_> {
    fn claim_node(&mut self) -> Result<(), WireError> {
        if self.nodes >= MAX_STRUCTURE_NODES {
            return Err(WireError::MessageInvalid);
        }
        self.nodes += 1;
        Ok(())
    }
    fn peek(&self) -> Option<u8> {
        self.source.as_bytes().get(self.offset).copied()
    }
    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.offset += 1;
        }
    }
    fn string(&mut self) -> Result<String, WireError> {
        let start = self.offset;
        self.offset += 1;
        while let Some(byte) = self.peek() {
            self.offset += 1;
            match byte {
                b'"' => {
                    return serde_json::from_str(&self.source[start..self.offset])
                        .map_err(|_| WireError::JsonInvalid);
                }
                b'\\' => {
                    self.offset += 1;
                }
                0..=0x1f => return Err(WireError::JsonInvalid),
                _ => {}
            }
        }
        Err(WireError::JsonInvalid)
    }
    fn value(&mut self, depth: u8) -> Result<Value, WireError> {
        self.claim_node()?;
        self.whitespace();
        match self.peek() {
            Some(b'"') => self.string().map(Value::String),
            Some(b'{' | b'[') if depth >= 16 => Err(WireError::JsonInvalid),
            Some(b'{') => self.object(depth + 1),
            Some(b'[') => self.array(depth + 1),
            _ => {
                for (literal, value) in [
                    ("null", Value::Null),
                    ("true", Value::Bool(true)),
                    ("false", Value::Bool(false)),
                ] {
                    if self.source[self.offset..].starts_with(literal) {
                        self.offset += literal.len();
                        return Ok(value);
                    }
                }
                let start = self.offset;
                while let Some(byte) = self.peek() {
                    if matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | b',' | b'}' | b']') {
                        break;
                    }
                    self.offset += 1;
                }
                let token = &self.source[start..self.offset];
                if token.is_empty()
                    || !token.bytes().all(|b| b.is_ascii_digit())
                    || (token.len() > 1 && token.starts_with('0'))
                {
                    return Err(WireError::JsonInvalid);
                }
                // All valid numeric fields are <= u32::MAX. Saturating larger
                // canonical tokens preserves JS's schema error (rather than
                // wrongly classifying an unsigned JSON token as bad syntax).
                Ok(Value::from(token.parse::<u64>().unwrap_or(u64::MAX)))
            }
        }
    }
    fn object(&mut self, depth: u8) -> Result<Value, WireError> {
        let mut result = Map::new();
        self.offset += 1;
        self.whitespace();
        if self.peek() == Some(b'}') {
            self.offset += 1;
            return Ok(Value::Object(result));
        }
        loop {
            self.whitespace();
            if self.peek() != Some(b'"') {
                return Err(WireError::JsonInvalid);
            }
            if result.len() >= MAX_OBJECT_KEYS {
                return Err(WireError::MessageInvalid);
            }
            self.claim_node()?;
            let key = self.string()?;
            if result.contains_key(&key) {
                return Err(WireError::JsonInvalid);
            }
            self.whitespace();
            if self.peek() != Some(b':') {
                return Err(WireError::JsonInvalid);
            }
            self.offset += 1;
            result.insert(key, self.value(depth)?);
            self.whitespace();
            match self.peek() {
                Some(b'}') => {
                    self.offset += 1;
                    return Ok(Value::Object(result));
                }
                Some(b',') => self.offset += 1,
                _ => return Err(WireError::JsonInvalid),
            }
        }
    }
    fn array(&mut self, depth: u8) -> Result<Value, WireError> {
        let mut result = Vec::new();
        self.offset += 1;
        self.whitespace();
        if self.peek() == Some(b']') {
            self.offset += 1;
            return Ok(Value::Array(result));
        }
        loop {
            if result.len() >= MAX_ARRAY_ENTRIES {
                return Err(WireError::MessageInvalid);
            }
            result.push(self.value(depth)?);
            self.whitespace();
            match self.peek() {
                Some(b']') => {
                    self.offset += 1;
                    return Ok(Value::Array(result));
                }
                Some(b',') => self.offset += 1,
                _ => return Err(WireError::JsonInvalid),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Direction, Message, SensorMessage, decode_payload};
    use serde_json::json;

    fn parser(source: &str) -> Parser<'_> {
        Parser {
            source,
            offset: 0,
            nodes: 0,
        }
    }

    #[test]
    fn array_budget_stops_before_parsing_or_allocating_excess_element() {
        let prefix = format!("[{},", vec!["{}"; 4096].join(","));
        let source = format!("{prefix}@]");
        let mut parser = parser(&source);
        assert_eq!(parser.value(0), Err(WireError::MessageInvalid));
        assert_eq!(parser.offset, prefix.len());
        assert_eq!(parser.nodes, 4097);
        // Without the early guard the malformed excess element yields JSON
        // syntax failure, proving this did not reach later schema validation.
        assert_eq!(
            decode_payload(source.as_bytes(), Direction::HostToSensor),
            Err(WireError::MessageInvalid)
        );
    }

    #[test]
    fn object_budget_stops_before_allocating_the_excess_key() {
        let fields = (0..16)
            .map(|i| format!("\"{i}\":null"))
            .collect::<Vec<_>>()
            .join(",");
        let prefix = format!("{{{fields},");
        let source = format!("{prefix}\"excess\":@}}");
        let mut parser = parser(&source);
        assert_eq!(parser.value(0), Err(WireError::MessageInvalid));
        assert_eq!(parser.offset, prefix.len());
        assert_eq!(parser.nodes, 33);
        assert_eq!(
            decode_payload(source.as_bytes(), Direction::HostToSensor),
            Err(WireError::MessageInvalid)
        );
    }

    #[test]
    fn global_budget_stops_nested_breadth_before_the_malformed_suffix() {
        // Each container obeys its own local bound and depth is only four.
        let leaf = format!("[{}]", vec!["{}"; 32].join(","));
        let fields = (0..16)
            .map(|i| format!("\"{i}\":{leaf}"))
            .collect::<Vec<_>>()
            .join(",");
        let row = format!("{{{fields}}}");
        let prefix = format!("[{},", vec![row; 300].join(","));
        let source = format!("{prefix}@]");
        assert!(source.len() < 600_000);
        let mut parser = parser(&source);
        assert_eq!(parser.value(0), Err(WireError::MessageInvalid));
        assert_eq!(parser.nodes, 140_000);
        assert!(parser.offset < prefix.len());
        assert_eq!(
            decode_payload(source.as_bytes(), Direction::HostToSensor),
            Err(WireError::MessageInvalid)
        );
    }

    #[test]
    fn densest_legal_frame_fits_the_global_structure_budget() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/sensor-wire/cases.json"
        ))
        .unwrap();
        let case = cases
            .iter()
            .find(|case| case["name"] == "events-darwin")
            .unwrap();
        let fixture: Value = serde_json::from_str(case["json"].as_str().unwrap()).unwrap();
        let row = &fixture["events"][2];
        let events: Vec<Value> = (1..=4096)
            .map(|seq| {
                let mut row = row.clone();
                row["seq"] = seq.to_string().into();
                row
            })
            .collect();
        let payload =
            serde_json::to_string(&json!({"t":"evs","from":"1","to":"4096","events":events}))
                .unwrap();
        let mut parser = parser(&payload);
        assert!(parser.value(0).is_ok());
        assert_eq!(parser.offset, payload.len());
        assert_eq!(parser.nodes, 135_177);
        let message = decode_payload(payload.as_bytes(), Direction::SensorToHost).unwrap();
        match message {
            Message::Sensor(message) => match *message {
                SensorMessage::Evs { events, .. } => assert_eq!(events.len(), 4096),
                _ => panic!("expected event batch"),
            },
            _ => panic!("expected sensor message"),
        }
    }
}
