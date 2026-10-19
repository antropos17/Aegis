mod common;
use aegis_wire::{WireError, decode_payload};
use common::*;
#[test]
fn malformed_ambiguous_or_lossy_json_is_rejected_before_schema() {
    let invalid = [
        r#"{"t":"stop","t":"snap","id":1}"#,
        r#"{"t":"stop","\u0074":"snap","id":1}"#,
        r#"{"t":"paths","id":1,"prefixes":[],"id":2}"#,
        r#"{"t":"stop","id":1,}"#,
        r#"{"t":"stop","id":1} true"#,
        r#"{"t":"paths","id":1,"prefixes":["a",]}"#,
        r#"{"t":"paths","id":1,"prefixes":["\uD800"]}"#,
        r#"{"t":"paths","id":1,"prefixes":["\uDC00"]}"#,
        r#"{"t":"paths","id":1,"prefixes":["\uD800x"]}"#,
        r#"{"t":"paths","id":1,"prefixes":["\x41"]}"#,
        "{\"t\":\"paths\",\"id\":1,\"prefixes\":[\"line\nbreak\"]}",
        r#"{"t":"stop","id":1"#,
        " ",
        "{",
        r#"{"t":"watch","id":1,"roots":[{"pid":1,"birth":"0","witness":{"kind":"linux-start-ticks","bootId":"11111111-1111-4111-8111-111111111111","startTicks":"0","\u0073tartTicks":"0"}}],"descendants":true}"#,
    ];
    for text in invalid {
        assert_eq!(
            decode_payload(text.as_bytes(), H),
            Err(WireError::JsonInvalid),
            "{text}"
        );
    }
    for token in [
        "1.0", "1e0", "1E0", "-0", "-1", "+1", "01", "NaN", "Infinity",
    ] {
        let text = format!(r#"{{"t":"stop","id":{token}}}"#);
        assert_eq!(
            decode_payload(text.as_bytes(), H),
            Err(WireError::JsonInvalid),
            "{token}"
        );
    }
}
#[test]
fn utf8_is_fatal_without_bom_stripping_or_replacement() {
    for bytes in [
        vec![0xef, 0xbb, 0xbf, b'{', b'}'],
        vec![0xc0, 0xaf],
        vec![0x80],
        vec![0xe2, 0x82],
        vec![0xed, 0xa0, 0x80],
        vec![0xf4, 0x90, 0x80, 0x80],
    ] {
        assert_eq!(decode_payload(&bytes, H), Err(WireError::Utf8Invalid));
    }
}
#[test]
fn root_counts_as_container_one() {
    for (n, error) in [
        (15, WireError::MessageInvalid),
        (16, WireError::JsonInvalid),
    ] {
        for (open, close) in [("[", "]"), ("{\"x\":", "}")] {
            let text = format!("{{\"x\":{}0{}}}", open.repeat(n), close.repeat(n));
            assert_eq!(decode_payload(text.as_bytes(), H), Err(error));
        }
    }
}
#[test]
fn scalar_json_and_unsigned_out_of_range_integers_are_schema_errors() {
    for text in [
        "null",
        "[]",
        "1",
        "\"text\"",
        "true",
        r#"{"__proto__":{"polluted":true}}"#,
        r#"{"t":"stop","id":18446744073709551616}"#,
    ] {
        assert_eq!(
            decode_payload(text.as_bytes(), H),
            Err(WireError::MessageInvalid)
        );
    }
    let huge = format!(r#"{{"t":"stop","id":{}}}"#, "9".repeat(400));
    assert_eq!(
        decode_payload(huge.as_bytes(), H),
        Err(WireError::MessageInvalid)
    );
}
#[test]
fn normal_whitespace_escaped_scalars_and_key_order_are_accepted() {
    let decoded = decode_payload(
        b" \t\r\n{ \"prefixes\":[\"/fixture/\\uD83E\\uDDEA\"], \"id\":1, \"t\" : \"paths\" }\n",
        H,
    )
    .unwrap();
    let expected = decode(
        &serde_json::json!({"t":"paths","id":1,"prefixes":["/fixture/🧪"]}),
        H,
    )
    .unwrap();
    assert_eq!(decoded, expected);
}
