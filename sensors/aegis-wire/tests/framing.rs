mod common;
use aegis_wire::{FrameDecoder, MAX_FRAME_BYTES, WireError};
use common::*;
#[test]
fn concatenated_frames_deliver_in_order_and_keep_only_incomplete_body() {
    let one = frame(r#"{"t":"stop","id":1}"#);
    let two = frame(r#"{"t":"snap","id":2}"#);
    let mut input = one.clone();
    input.extend_from_slice(&two);
    input.extend_from_slice(&one[..7]);
    let mut decoder = FrameDecoder::new(H);
    let mut delivered = Vec::new();
    let status = decoder.push(&input, |message| {
        delivered.push(message);
        Ok(())
    });
    assert_eq!(status.decoded_count, 2);
    assert!(!status.fatal);
    assert_eq!(decoder.pending_bytes(), 7);
    assert_ne!(delivered[0], delivered[1]);
    let rest = decoder.push(&one[7..], |_| Ok(()));
    assert_eq!(rest.decoded_count, 1);
    assert!(!rest.fatal);
    assert_eq!(decoder.pending_bytes(), 0);
    assert!(!decoder.finish().fatal);
}
#[test]
fn every_incomplete_header_or_body_fails_on_eof() {
    let bytes = frame(r#"{"t":"stop","id":1}"#);
    for length in 1..bytes.len() {
        let mut decoder = FrameDecoder::new(H);
        assert!(
            !decoder
                .push(&bytes[..length], |_| panic!("partial frame delivered"))
                .fatal
        );
        assert_eq!(decoder.finish().error_code, Some(WireError::FrameTruncated));
        assert_eq!(decoder.pending_bytes(), 0);
        assert_eq!(
            decoder
                .push(&bytes, |_| panic!("fatal decoder delivered"))
                .error_code,
            Some(WireError::FrameTruncated)
        );
    }
}
#[test]
fn invalid_frame_lengths_fail_on_header_without_buffering_a_body() {
    assert_eq!(MAX_FRAME_BYTES, 8_388_608);
    for length in [0, MAX_FRAME_BYTES as u32 + 1, u32::MAX] {
        let mut decoder = FrameDecoder::new(H);
        assert_eq!(
            decoder
                .push(&length.to_le_bytes()[..3], |_| Ok(()))
                .error_code,
            None
        );
        assert_eq!(decoder.pending_bytes(), 3);
        assert_eq!(
            decoder
                .push(&length.to_le_bytes()[3..], |_| Ok(()))
                .error_code,
            Some(WireError::FrameLengthInvalid)
        );
        assert_eq!(decoder.pending_bytes(), 0);
    }
}
#[test]
fn frame_limit_is_inclusive_and_input_is_owned_after_each_push() {
    let mut payload = br#"{"t":"stop","id":1}"#.to_vec();
    payload.resize(MAX_FRAME_BYTES, b' ');
    let bytes = frame(&payload);
    let mut decoder = FrameDecoder::new(H);
    assert_eq!(decoder.push(&bytes, |_| Ok(())).decoded_count, 1);
    assert!(!decoder.finish().fatal);
    let mut decoder = FrameDecoder::new(H);
    let mut first = bytes[..5].to_vec();
    assert!(!decoder.push(&first, |_| Ok(())).fatal);
    first.fill(0);
    assert_eq!(decoder.push(&bytes[5..], |_| Ok(())).decoded_count, 1);
}
#[test]
fn errors_are_terminal_and_successful_prior_deliveries_are_preserved() {
    let good = frame(r#"{"t":"stop","id":1}"#);
    for (payload, error) in [
        (b"{bad".as_slice(), WireError::JsonInvalid),
        (
            br#"{"t":"no","id":1}"#.as_slice(),
            WireError::MessageInvalid,
        ),
        (&[0xff], WireError::Utf8Invalid),
    ] {
        let mut input = good.clone();
        input.extend_from_slice(&frame(payload));
        input.extend_from_slice(&good);
        let mut decoder = FrameDecoder::new(H);
        let status = decoder.push(&input, |_| Ok(()));
        assert_eq!(status.decoded_count, 1);
        assert_eq!(status.error_code, Some(error));
        assert_eq!(decoder.pending_bytes(), 0);
        assert_eq!(
            decoder
                .push(&good, |_| panic!("delivery after error"))
                .error_code,
            Some(error)
        );
        assert_eq!(decoder.finish().error_code, Some(error));
    }
}
#[test]
fn protocol_version_is_a_hard_stop_and_cannot_resynchronize() {
    let mut hello = fixture("hello-ebpf");
    hello["proto"] = "sensor/2".into();
    let bad = frame(serde_json::to_vec(&hello).unwrap());
    let mut input = bad;
    input.extend_from_slice(&frame(cases()[0]["json"].as_str().unwrap()));
    let mut decoder = FrameDecoder::new(S);
    assert_eq!(
        decoder
            .push(&input, |_| panic!("unknown protocol delivered"))
            .error_code,
        Some(WireError::ProtocolUnsupported)
    );
    assert_eq!(decoder.pending_bytes(), 0);
    assert!(decoder.finish().fatal);
}
#[test]
fn callback_errors_and_panics_stop_before_any_later_frame() {
    let one = frame(r#"{"t":"stop","id":1}"#);
    let mut input = one.clone();
    input.extend_from_slice(&one);
    let mut decoder = FrameDecoder::new(H);
    let mut calls = 0;
    let status = decoder.push(&input, |_| {
        calls += 1;
        Err(())
    });
    assert_eq!(calls, 1);
    assert_eq!(status.decoded_count, 0);
    assert_eq!(status.error_code, Some(WireError::CallbackFailed));
    assert_eq!(decoder.pending_bytes(), 0);
    assert_eq!(
        decoder.push(&one, |_| panic!("late callback")).error_code,
        Some(WireError::CallbackFailed)
    );
    let mut decoder = FrameDecoder::new(H);
    assert_eq!(
        decoder
            .push(&input, |_| panic!("synthetic callback panic"))
            .error_code,
        Some(WireError::CallbackFailed)
    );
}
#[test]
fn clean_eof_is_idempotent_and_later_even_empty_input_is_closed() {
    let mut decoder = FrameDecoder::new(H);
    assert!(!decoder.push(&[], |_| Ok(())).fatal);
    assert_eq!(decoder.finish(), decoder.finish());
    assert_eq!(
        decoder.push(&[], |_| Ok(())).error_code,
        Some(WireError::DecoderClosed)
    );
    assert_eq!(decoder.finish().error_code, Some(WireError::DecoderClosed));
}
