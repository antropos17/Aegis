mod common;
use aegis_wire::{
    DecimalU64, HostMessage, MAX_FRAME_BYTES, Message, SensorMessage, WireError, decode_payload,
    encode_frame,
};
use common::*;
use serde_json::{Value, json};
#[test]
fn text_limits_measure_utf8_bytes_and_exclude_empty_and_nul() {
    for (name, direction, pointer, limit) in [
        ("paths", H, "/prefixes/0", 4096),
        ("snapshot-linux", S, "/procs/0/name", 256),
        ("hello-ebpf", S, "/versions/sensor", 128),
        ("events-linux", S, "/events/0/exe", 4096),
        ("events-linux", S, "/events/1/path", 4096),
    ] {
        let mut value = fixture(name);
        *value.pointer_mut(pointer).unwrap() = "x".repeat(limit).into();
        assert!(decode(&value, direction).is_ok());
        *value.pointer_mut(pointer).unwrap() = "🧪".repeat(limit / 4).into();
        assert!(decode(&value, direction).is_ok());
        for text in [
            String::new(),
            "x".repeat(limit + 1),
            "é".repeat(limit),
            "x\0y".into(),
        ] {
            *value.pointer_mut(pointer).unwrap() = text.into();
            invalid(&value, direction);
        }
    }
}
#[test]
fn numeric_bounds_reject_strings_booleans_and_outside_values() {
    for id in [
        json!(0),
        json!(-1),
        json!(1.5),
        json!(4294967296u64),
        json!("1"),
        json!(true),
        Value::Null,
    ] {
        assert!(decode(&json!({"t":"stop","id":id}), H).is_err());
    }
    assert!(decode(&json!({"t":"stop","id":4294967295u64}), H).is_ok());
    for (pointer, invalids) in [
        ("/events/0/pid", vec![json!(0), json!(2147483648u64)]),
        ("/events/0/ppid", vec![json!(2147483648u64)]),
        ("/events/0/argc", vec![json!(4294967296u64)]),
        ("/events/2/sport", vec![json!(65536)]),
    ] {
        for bad in invalids {
            let mut value = fixture("events-linux");
            *value.pointer_mut(pointer).unwrap() = bad;
            invalid(&value, S);
        }
    }
    let mut value = fixture("events-linux");
    value["events"][0]["argc"] = json!(u32::MAX);
    assert!(decode(&value, S).is_ok());
    assert_eq!(
        "18446744073709551615".parse::<DecimalU64>().unwrap().get(),
        u64::MAX
    );
    for value in ["01", "+1", "-1", "18446744073709551616"] {
        assert!(value.parse::<DecimalU64>().is_err());
    }
}
#[test]
fn each_collection_accepts_its_ceiling_and_rejects_one_more() {
    for (name, key, direction, max) in [
        ("snapshot-linux", "procs", S, 4096),
        ("watch-linux", "roots", H, 4096),
        ("paths", "prefixes", H, 1024),
        ("events-linux", "events", S, 4096),
    ] {
        let mut value = fixture(name);
        let row = value[key][0].clone();
        let make = |i: usize| {
            if key == "prefixes" {
                json!(format!("/fixture/{i}"))
            } else {
                let mut row = row.clone();
                row[if key == "events" { "seq" } else { "pid" }] = if key == "events" {
                    json!((i + 1).to_string())
                } else {
                    json!(i + 1)
                };
                row
            }
        };
        value[key] = (0..max).map(make).collect();
        if key == "events" {
            value["from"] = "1".into();
            value["to"] = max.to_string().into();
        }
        assert!(decode(&value, direction).is_ok(), "{key} ceiling");
        value[key].as_array_mut().unwrap().push(make(max));
        if key == "events" {
            value["to"] = (max + 1).to_string().into();
        }
        invalid(&value, direction);
    }
    invalid(&json!({"t":"paths","id":1,"prefixes":["same","same"]}), H);
}
#[test]
fn oversized_payloads_are_bounded_on_decode_and_encode() {
    assert_eq!(
        decode_payload(&vec![b' '; MAX_FRAME_BYTES + 1], H),
        Err(WireError::FrameLengthInvalid)
    );
    // The producer owns this Vec; the encoder's output writer stops at 8 MiB.
    let message = Message::Host(HostMessage::Paths {
        id: 1,
        prefixes: vec!["x".repeat(MAX_FRAME_BYTES + 1)],
    });
    assert_eq!(encode_frame(&message), Err(WireError::FrameLengthInvalid));
    let mut value = fixture("events-linux");
    let mut row = value["events"][0].clone();
    row["exe"] = "x".repeat(4096).into();
    value["events"] = (0..4096)
        .map(|i| {
            let mut row = row.clone();
            row["seq"] = (i + 1).to_string().into();
            row
        })
        .collect();
    value["from"] = "1".into();
    value["to"] = "4096".into();
    let message: SensorMessage = serde_json::from_value(value).unwrap();
    assert_eq!(
        encode_frame(&Message::from(message)),
        Err(WireError::FrameLengthInvalid)
    );
}
