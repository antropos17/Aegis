use crate::{Direction, WireError, observations, types::parse_decimal};
use serde_json::Value;
use std::collections::HashSet;
pub(crate) type Check = Result<(), WireError>;
const BAD: WireError = WireError::MessageInvalid;
pub(crate) fn exact(value: &Value, keys: &[&str]) -> Check {
    let object = value.as_object().ok_or(BAD)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(BAD);
    }
    Ok(())
}
pub(crate) fn choice(value: &Value, allowed: &[&str]) -> Check {
    let text = value.as_str().ok_or(BAD)?;
    if allowed.contains(&text) {
        Ok(())
    } else {
        Err(BAD)
    }
}
pub(crate) fn text(value: &Value, max: usize) -> Check {
    let text = value.as_str().ok_or(BAD)?;
    if text.is_empty() || text.len() > max || text.contains('\0') {
        return Err(BAD);
    }
    Ok(())
}
pub(crate) fn integer(value: &Value, min: u64, max: u64) -> Check {
    let number = value.as_u64().ok_or(BAD)?;
    if number < min || number > max {
        return Err(BAD);
    }
    Ok(())
}
pub(crate) fn decimal(value: &Value, positive: bool) -> Result<u64, WireError> {
    let number = value.as_str().and_then(parse_decimal).ok_or(BAD)?;
    if positive && number == 0 {
        return Err(BAD);
    }
    Ok(number)
}
pub(crate) fn array(value: &Value, min: usize, max: usize) -> Result<&[Value], WireError> {
    let entries = value.as_array().ok_or(BAD)?;
    if entries.len() < min || entries.len() > max {
        return Err(BAD);
    }
    Ok(entries)
}
fn unique<'a>(values: impl Iterator<Item = &'a Value>) -> Check {
    let mut seen = HashSet::new();
    for value in values {
        // Keys are bounded primitive strings or integer PIDs, never nested data.
        if !seen.insert(value.to_string()) {
            return Err(BAD);
        }
    }
    Ok(())
}
pub(crate) fn mode_platform(mode: &Value) -> Result<&'static str, WireError> {
    match mode.as_str() {
        Some("ebpf" | "fanotify" | "procfs") => Ok("linux"),
        Some("endpoint-security" | "libproc") => Ok("darwin"),
        _ => Err(BAD),
    }
}
fn interval(value: &Value) -> Result<(u64, u64, u64), WireError> {
    let from = decimal(&value["from"], true)?;
    let to = decimal(&value["to"], true)?;
    let count = to
        .checked_sub(from)
        .and_then(|n| n.checked_add(1))
        .ok_or(BAD)?;
    Ok((from, to, count))
}
pub(crate) fn validate(value: &Value, direction: Direction) -> Check {
    match direction {
        Direction::HostToSensor => host(value),
        Direction::SensorToHost => sensor(value),
    }
}
fn host(value: &Value) -> Check {
    match value["t"].as_str() {
        Some("snap" | "stop") => exact(value, &["t", "id"]),
        Some("paths") => {
            exact(value, &["t", "id", "prefixes"])?;
            let prefixes = array(&value["prefixes"], 0, 1024)?;
            for prefix in prefixes {
                text(prefix, 4096)?;
            }
            unique(prefixes.iter())
        }
        Some("watch") => {
            exact(value, &["t", "id", "roots", "descendants"])?;
            if value["descendants"] != true {
                return Err(BAD);
            }
            let roots = array(&value["roots"], 0, 4096)?;
            let mut platform = None;
            for root in roots {
                observations::watch_root(root, &mut platform)?;
            }
            unique(roots.iter().map(|root| &root["pid"]))
        }
        _ => Err(BAD),
    }?;
    integer(&value["id"], 1, u64::from(u32::MAX))
}
fn sensor(value: &Value) -> Check {
    match value["t"].as_str() {
        Some("hello") => {
            exact(
                value,
                &[
                    "t", "proto", "platform", "mode", "modes", "caps", "versions", "pid",
                ],
            )?;
            if !value["proto"].is_string() {
                return Err(BAD);
            }
            if value["proto"] != "sensor/1" {
                return Err(WireError::ProtocolUnsupported);
            }
            choice(&value["platform"], &["linux", "darwin"])?;
            let platform = mode_platform(&value["mode"])?;
            let modes = array(&value["modes"], 1, 5)?;
            unique(modes.iter())?;
            if value["platform"] != platform || !modes.contains(&value["mode"]) {
                return Err(BAD);
            }
            for mode in modes {
                if mode_platform(mode)? != platform {
                    return Err(BAD);
                }
            }
            observations::capabilities(&value["caps"], &value["mode"])?;
            observations::versions(&value["versions"], platform)?;
            integer(&value["pid"], 1, i32::MAX as u64)
        }
        Some("mode") => {
            exact(value, &["t", "mode", "caps", "reason", "seq"])?;
            observations::capabilities(&value["caps"], &value["mode"])?;
            choice(
                &value["reason"],
                &[
                    "startup-fallback",
                    "permission-denied",
                    "attach-failed",
                    "read-failed",
                    "recovery",
                    "requested",
                ],
            )?;
            decimal(&value["seq"], true).map(|_| ())
        }
        Some("evs") => {
            exact(value, &["t", "from", "to", "events"])?;
            let (from, _, count) = interval(value)?;
            let events = array(&value["events"], 1, 4096)?;
            let mut platform = None;
            for (index, event) in events.iter().enumerate() {
                observations::event(event, &mut platform)?;
                if decimal(&event["seq"], true)? != from.checked_add(index as u64).ok_or(BAD)? {
                    return Err(BAD);
                }
            }
            if count != events.len() as u64 {
                return Err(BAD);
            }
            Ok(())
        }
        Some("loss") => {
            exact(value, &["t", "from", "to", "count", "reason"])?;
            let (_, _, count) = interval(value)?;
            if decimal(&value["count"], true)? != count {
                return Err(BAD);
            }
            choice(
                &value["reason"],
                &["ring-full", "queue-full", "verifier-limit", "read-failed"],
            )
            .map(|_| ())
        }
        Some("snap") => {
            exact(value, &["t", "id", "procs"])?;
            integer(&value["id"], 1, u64::from(u32::MAX))?;
            let procs = array(&value["procs"], 0, 4096)?;
            let mut platform = None;
            for process in procs {
                observations::process(process, &mut platform)?;
            }
            unique(procs.iter().map(|process| &process["pid"]))
        }
        Some("health") => {
            exact(value, &["t", "state", "detail"])?;
            choice(
                &value["state"],
                &[
                    "STARTING",
                    "HEALTHY",
                    "DEGRADED",
                    "FAILED",
                    "DISABLED",
                    "UNSUPPORTED",
                ],
            )?;
            choice(
                &value["detail"],
                &[
                    "starting",
                    "ready",
                    "permission-denied",
                    "read-failed",
                    "loss-observed",
                    "sensor-failed",
                    "disabled",
                    "unsupported",
                ],
            )
            .map(|_| ())
        }
        Some("err") => {
            exact(value, &["t", "id", "code"])?;
            integer(&value["id"], 1, u64::from(u32::MAX))?;
            choice(
                &value["code"],
                &[
                    "request-failed",
                    "root-mismatch",
                    "permission-denied",
                    "read-failed",
                    "unsupported",
                    "request-too-large",
                ],
            )
            .map(|_| ())
        }
        Some("ack") => {
            exact(value, &["t", "id"])?;
            integer(&value["id"], 1, u64::from(u32::MAX))
        }
        _ => Err(BAD),
    }
}
