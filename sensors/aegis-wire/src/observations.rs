use crate::{
    WireError,
    schema::{Check, choice, decimal, exact, integer, mode_platform, text},
};
use serde_json::Value;
use std::net::IpAddr;
const BAD: WireError = WireError::MessageInvalid;

pub(crate) fn capabilities(value: &Value, mode: &Value) -> Check {
    let platform = mode_platform(mode)?;
    exact(
        value,
        &[
            "exec",
            "exit",
            "fork",
            "fileOpen",
            "tcpConnect",
            "identity",
            "witness",
        ],
    )?;
    for key in ["exec", "exit", "fork", "fileOpen", "tcpConnect"] {
        if !value[key].is_boolean() {
            return Err(BAD);
        }
    }
    let identity = match platform {
        "linux" if mode == "ebpf" => "bpf-start-boottime-ticks",
        "linux" => "procfs-ticks",
        _ => "pbi-start-usec",
    };
    if value["identity"] != identity
        || value["witness"]
            != if platform == "linux" {
                "boot-id"
            } else {
                "p-uniqueid"
            }
        || (mode == "libproc" && value["fileOpen"] == true)
    {
        return Err(BAD);
    }
    Ok(())
}
pub(crate) fn versions(value: &Value, platform: &str) -> Check {
    let os_key = if platform == "linux" { "kernel" } else { "os" };
    exact(value, &["sensor", os_key, "clockAnchor"])?;
    text(&value["sensor"], 128)?;
    text(&value[os_key], 128)?;
    let anchor = &value["clockAnchor"];
    exact(anchor, &["clock", "monotonicUsec", "unixUsec"])?;
    if anchor["clock"]
        != if platform == "linux" {
            "boottime"
        } else {
            "mach-continuous"
        }
    {
        return Err(BAD);
    }
    decimal(&anchor["monotonicUsec"], false)?;
    decimal(&anchor["unixUsec"], false)?;
    Ok(())
}
fn uuid(value: &Value) -> Check {
    let value = value.as_str().ok_or(BAD)?;
    if value.len() != 36
        || !value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        return Err(BAD);
    }
    Ok(())
}
fn identity(value: &Value, watch: bool, platform: &mut Option<&'static str>) -> Check {
    let birth = &value["birth"];
    let witness = &value["witness"];
    if !watch && birth.is_null() && witness.is_null() {
        choice(
            &value["identityError"],
            &["read-failed", "process-gone", "not-supported"],
        )?;
        return Ok(());
    }
    if !watch && !value["identityError"].is_null() {
        return Err(BAD);
    }
    decimal(birth, false)?;
    let observed = match witness["kind"].as_str() {
        Some("linux-start-ticks") => {
            exact(witness, &["kind", "bootId", "startTicks"])?;
            uuid(&witness["bootId"])?;
            decimal(&witness["startTicks"], false)?;
            if witness["startTicks"] != *birth {
                return Err(BAD);
            }
            "linux"
        }
        Some("macos-unique-id") => {
            exact(witness, &["kind", "bootSessionId", "pUniqueId"])?;
            uuid(&witness["bootSessionId"])?;
            decimal(&witness["pUniqueId"], true)?;
            "darwin"
        }
        _ => return Err(BAD),
    };
    if platform.is_some_and(|prior| prior != observed) {
        return Err(BAD);
    }
    *platform = Some(observed);
    Ok(())
}
pub(crate) fn process(value: &Value, platform: &mut Option<&'static str>) -> Check {
    exact(
        value,
        &["pid", "ppid", "name", "birth", "witness", "identityError"],
    )?;
    integer(&value["pid"], 1, i32::MAX as u64)?;
    integer(&value["ppid"], 0, i32::MAX as u64)?;
    text(&value["name"], 256)?;
    identity(value, false, platform)
}
pub(crate) fn watch_root(value: &Value, platform: &mut Option<&'static str>) -> Check {
    exact(value, &["pid", "birth", "witness"])?;
    integer(&value["pid"], 1, i32::MAX as u64)?;
    identity(value, true, platform)
}
pub(crate) fn event(value: &Value, platform: &mut Option<&'static str>) -> Check {
    let mut keys = vec![
        "seq",
        "kind",
        "pid",
        "ppid",
        "birth",
        "witness",
        "identityError",
        "ts",
    ];
    match value["kind"].as_str() {
        Some("exec") => keys.extend(["exe", "argc"]),
        Some("open") => keys.extend(["path", "access"]),
        Some("connect") => keys.extend(["family", "daddr", "dport", "saddr", "sport"]),
        Some("fork" | "exit") => {}
        _ => return Err(BAD),
    }
    exact(value, &keys)?;
    decimal(&value["seq"], true)?;
    integer(&value["pid"], 1, i32::MAX as u64)?;
    integer(&value["ppid"], 0, i32::MAX as u64)?;
    identity(value, false, platform)?;
    decimal(&value["ts"], false)?;
    match value["kind"].as_str() {
        Some("exec") => {
            text(&value["exe"], 4096)?;
            integer(&value["argc"], 0, u64::from(u32::MAX))
        }
        Some("open") => {
            text(&value["path"], 4096)?;
            choice(
                &value["access"],
                &["read", "write", "read-write", "execute"],
            )
            .map(|_| ())
        }
        Some("connect") => {
            let family = value["family"].as_u64().ok_or(BAD)?;
            if family != 4 && family != 6 {
                return Err(BAD);
            }
            for key in ["daddr", "saddr"] {
                let address = value[key].as_str().ok_or(BAD)?;
                let parsed: IpAddr = address.parse().map_err(|_| BAD)?;
                if address.contains('%') || (family == 4) != parsed.is_ipv4() {
                    return Err(BAD);
                }
            }
            integer(&value["dport"], 0, 65535)?;
            integer(&value["sport"], 0, 65535)
        }
        _ => Ok(()),
    }
}
