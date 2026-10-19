mod common;
use aegis_wire::{HostMessage, Message, SensorMessage, WireError, decode_payload, encode_frame};
use common::*;
use serde_json::{Value, json};
fn object_paths(value: &Value, path: String, result: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            result.push(path.clone());
            for (key, value) in object {
                object_paths(value, format!("{path}/{key}"), result);
            }
        }
        Value::Array(array) => {
            for (index, value) in array.iter().enumerate() {
                object_paths(value, format!("{path}/{index}"), result);
            }
        }
        _ => {}
    }
}
#[test]
fn every_object_in_every_fixture_is_closed_and_every_field_is_required() {
    for case in cases() {
        let direction = if case["direction"] == "host-to-sensor" {
            H
        } else {
            S
        };
        let value: Value = serde_json::from_str(case["json"].as_str().unwrap()).unwrap();
        let mut paths = Vec::new();
        object_paths(&value, String::new(), &mut paths);
        for path in paths {
            let mut extra = value.clone();
            extra
                .pointer_mut(&path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("privateUnknown".into(), "synthetic".into());
            invalid(&extra, direction);
            for key in value.pointer(&path).unwrap().as_object().unwrap().keys() {
                let mut missing = value.clone();
                missing
                    .pointer_mut(&path)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(key);
                invalid(&missing, direction);
            }
        }
    }
}
#[test]
fn closed_vocabularies_capabilities_and_clocks_are_enforced() {
    for (name, pointer, replacement) in [
        ("health", "/t", json!("unknown")),
        ("health", "/state", json!("GOOD")),
        ("health", "/detail", json!("private")),
        ("error", "/code", json!("private")),
        ("mode-ebpf", "/reason", json!("private")),
        ("loss-u64", "/reason", json!("private")),
        ("hello-ebpf", "/platform", json!("darwin")),
        ("hello-ebpf", "/mode", json!("future")),
        ("hello-ebpf", "/modes", json!(["ebpf", "libproc"])),
        ("hello-ebpf", "/modes", json!(["ebpf", "ebpf"])),
        ("hello-ebpf", "/modes", json!(["procfs"])),
        ("hello-ebpf", "/modes", json!([])),
        ("hello-ebpf", "/caps/identity", json!("procfs-ticks")),
        ("hello-ebpf", "/caps/witness", json!("p-uniqueid")),
        ("hello-ebpf", "/caps/exec", json!(1)),
        ("hello-libproc", "/caps/fileOpen", json!(true)),
        (
            "hello-ebpf",
            "/versions/clockAnchor/clock",
            json!("mach-continuous"),
        ),
        ("hello-ebpf", "/versions/clockAnchor/unixUsec", json!(123)),
        ("events-linux", "/events/1/access", json!("all")),
        ("events-linux", "/events/2/family", json!(6)),
        ("events-darwin", "/events/2/saddr", json!("fe80::1%eth0")),
        ("events-linux", "/events/2/daddr", json!("999.1.1.1")),
        ("events-linux", "/events/2/dport", json!(65536)),
        ("events-linux", "/events/0/kind", json!("future")),
    ] {
        let mut value = fixture(name);
        *value.pointer_mut(pointer).unwrap() = replacement;
        invalid(&value, S);
    }
    let mut hello = fixture("hello-ebpf");
    hello["proto"] = "sensor/future".into();
    assert_eq!(decode(&hello, S), Err(WireError::ProtocolUnsupported));
    hello["proto"] = json!(1);
    invalid(&hello, S);
    for key in ["exec", "exit", "fork", "fileOpen", "tcpConnect"] {
        let mut hello = fixture("hello-ebpf");
        hello["caps"][key] = false.into();
        assert!(
            decode(&hello, S).is_ok(),
            "mode name does not force true capability {key}"
        );
    }
}
#[test]
fn identity_is_composite_precise_and_cannot_be_repaired_from_partial_data() {
    for (name, pointer, replacement) in [
        ("snapshot-linux", "/procs/0/birth", json!("12346")),
        ("snapshot-linux", "/procs/0/birth", Value::Null),
        ("snapshot-linux", "/procs/0/witness", Value::Null),
        (
            "snapshot-linux",
            "/procs/0/identityError",
            json!("read-failed"),
        ),
        ("snapshot-linux", "/procs/1/identityError", Value::Null),
        (
            "snapshot-linux",
            "/procs/1/identityError",
            json!("arbitrary"),
        ),
        (
            "snapshot-linux",
            "/procs/0/witness/bootId",
            json!("11111111-1111-4111-8111-ABCDEF111111"),
        ),
        ("snapshot-darwin", "/procs/0/witness/pUniqueId", json!("0")),
        (
            "snapshot-darwin",
            "/procs/0/witness/pUniqueId",
            json!("18446744073709551616"),
        ),
    ] {
        let mut value = fixture(name);
        *value.pointer_mut(pointer).unwrap() = replacement;
        invalid(&value, S);
    }
    for (name, collection) in [
        ("snapshot-linux", "procs"),
        ("events-linux", "events"),
        ("watch-linux", "roots"),
    ] {
        let mut value = fixture(name);
        let other = fixture(if collection == "roots" {
            "watch-darwin"
        } else if collection == "procs" {
            "snapshot-darwin"
        } else {
            "events-darwin"
        });
        let mut row = other[collection][0].clone();
        row["pid"] = 43.into();
        if collection == "events" {
            row["seq"] = value[collection][1]["seq"].clone();
        }
        let rows = value[collection].as_array_mut().unwrap();
        if rows.len() == 1 {
            rows.push(row);
        } else {
            rows[1] = row;
        }
        invalid(&value, if collection == "roots" { H } else { S });
    }
    for name in ["snapshot-linux", "watch-linux"] {
        let key = if name == "watch-linux" {
            "roots"
        } else {
            "procs"
        };
        let mut value = fixture(name);
        let mut row = value[key][0].clone();
        row["pid"] = value[key][0]["pid"].clone();
        value[key].as_array_mut().unwrap().push(row);
        invalid(&value, if key == "roots" { H } else { S });
    }
    for replacement in [json!(false), json!(1), Value::Null] {
        let mut watch = fixture("watch-linux");
        watch["descendants"] = replacement;
        invalid(&watch, H);
    }
    let mut watch = fixture("watch-linux");
    watch["roots"][0]["birth"] = Value::Null;
    watch["roots"][0]["witness"] = Value::Null;
    invalid(&watch, H);
}
#[test]
fn u64_sequences_ranges_and_loss_counts_never_round_or_wrap() {
    for token in ["0", "00", "01", " 1", "1e3", "-1", "18446744073709551616"] {
        let mut value = fixture("mode-procfs");
        value["seq"] = token.into();
        invalid(&value, S);
    }
    for (pointer, replacement) in [
        ("/to", json!("9007199254740993")),
        ("/from", json!("9007199254740992")),
        ("/events/1/seq", json!("9007199254740993")),
        ("/events", json!([])),
    ] {
        let mut value = fixture("events-linux");
        *value.pointer_mut(pointer).unwrap() = replacement;
        invalid(&value, S);
    }
    for count in [
        json!("18446744073709551614"),
        json!("0"),
        json!("18446744073709551616"),
        json!(1),
    ] {
        let mut value = fixture("loss-u64");
        value["count"] = count;
        invalid(&value, S);
    }
    let mut value = fixture("loss-u64");
    value["from"] = value["to"].clone();
    value["to"] = "1".into();
    invalid(&value, S);
    let mut value = fixture("event-u64-max");
    let row = value["events"][0].clone();
    value["events"].as_array_mut().unwrap().push(row);
    invalid(&value, S);
    assert!(decode(&fixture("event-u64-max"), S).is_ok());
}
#[test]
fn typed_encoding_revalidates_constructed_values_and_direction_is_explicit() {
    assert_eq!(
        encode_frame(&Message::Host(HostMessage::Stop { id: 0 })),
        Err(WireError::MessageInvalid)
    );
    assert_eq!(
        encode_frame(&Message::Host(HostMessage::Watch {
            id: 1,
            roots: vec![],
            descendants: false
        })),
        Err(WireError::MessageInvalid)
    );
    let message = SensorMessage::Health {
        state: "HEALTHY".into(),
        detail: "synthetic private text".into(),
    };
    assert_eq!(
        encode_frame(&Message::from(message))
            .unwrap_err()
            .to_string(),
        "message-invalid"
    );
    for name in ["events-linux", "hello-ebpf", "snapshot-linux"] {
        let mut value = fixture(name);
        match name {
            "events-linux" => value["events"][0]["pid"] = 0.into(),
            "hello-ebpf" => value["caps"]["identity"] = "bad".into(),
            _ => value["procs"][0]["birth"] = "12346".into(),
        }
        let typed: SensorMessage = serde_json::from_value(value).unwrap();
        assert_eq!(
            encode_frame(&Message::from(typed)),
            Err(WireError::MessageInvalid)
        );
    }
    invalid(&fixture("health"), H);
    invalid(&fixture("stop"), S);
    invalid(&json!({"t":"snap","id":1,"procs":[]}), H);
    invalid(&json!({"t":"snap","id":1}), S);
    assert_eq!(decode_payload(&[], H), Err(WireError::FrameLengthInvalid));
}
