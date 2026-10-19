//! Process-only Linux sidecar. No privilege elevation or mode installation.

#[cfg(target_os = "linux")]
fn main() -> std::process::ExitCode {
    // A panic must not print process metadata or arbitrary request contents.
    std::panic::set_hook(Box::new(|_| eprintln!("sensor-failed")));
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            std::process::ExitCode::from(2)
        }
    }
}

#[cfg(target_os = "linux")]
fn run() -> Result<(), &'static str> {
    use aegis_sensor_linux::{FileSystemProcfs, Hello, ProcfsSource, parse_stat, serve};
    use aegis_wire::{ClockAnchor, DecimalU64};
    use rustix::time::{ClockId, clock_gettime};
    use std::time::{SystemTime, UNIX_EPOCH};

    if std::env::args_os().len() != 1 {
        return Err("unsupported");
    }
    let mut source = FileSystemProcfs::new("/proc");
    let pid = std::process::id();
    // Require a readable stat record for our PID before announcing the provider.
    parse_stat(&source.stat(pid).map_err(|_| "read-failed")?, pid).map_err(|_| "read-failed")?;
    let monotonic = clock_gettime(ClockId::Boottime);
    let monotonic_usec = u64::try_from(monotonic.tv_sec)
        .ok()
        .and_then(|seconds| seconds.checked_mul(1_000_000))
        .and_then(|usec| {
            u64::try_from(monotonic.tv_nsec)
                .ok()
                .and_then(|ns| usec.checked_add(ns / 1000))
        })
        .ok_or("read-failed")?;
    let unix_usec = u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "read-failed")?
            .as_micros(),
    )
    .map_err(|_| "read-failed")?;
    let hello = Hello {
        pid,
        kernel: source.kernel_version().map_err(|_| "read-failed")?,
        clock_anchor: ClockAnchor {
            clock: "boottime".into(),
            monotonic_usec: DecimalU64::new(monotonic_usec),
            unix_usec: DecimalU64::new(unix_usec),
        },
    };
    serve(
        &mut source,
        &mut std::io::stdin().lock(),
        &mut std::io::stdout().lock(),
        hello,
    )
    .map_err(|error| error.code())
}

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("unsupported");
    std::process::ExitCode::from(2)
}
