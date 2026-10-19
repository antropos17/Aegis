//! The only unsafe boundary: borrowed, writable byte slices passed to OS APIs.
use crate::{NativeError, reads::Backend};
use std::ffi::{c_char, c_int, c_void};

#[cfg(not(target_pointer_width = "64"))]
compile_error!("macOS libproc ABI requires a qualified 64-bit target");

#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, size: c_int)
    -> c_int;
    fn proc_listpids(kind: u32, info: u32, buffer: *mut c_void, size: c_int) -> c_int;
}
unsafe extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        old: *mut c_void,
        old_len: *mut usize,
        new: *mut c_void,
        new_len: usize,
    ) -> c_int;
}

pub(crate) struct System;

fn errno() -> NativeError {
    match std::io::Error::last_os_error().raw_os_error() {
        Some(3) => NativeError::ProcessGone,                 // ESRCH
        Some(2 | 22 | 45 | 78) => NativeError::NotSupported, // ENOENT/EINVAL/ENOTSUP/ENOSYS
        _ => NativeError::ReadFailed,
    }
}

impl Backend for System {
    fn pidinfo(&mut self, pid: i32, flavor: i32, out: &mut [u8]) -> Result<usize, NativeError> {
        let size = c_int::try_from(out.len()).map_err(|_| NativeError::InvalidData)?;
        // SAFETY: the slice owns `size` writable bytes for the synchronous call.
        // No OS pointer is retained; arg=0; fixed flavor/size pairs are checked by reads.
        let read = unsafe { proc_pidinfo(pid, flavor, 0, out.as_mut_ptr().cast(), size) };
        if read <= 0 {
            return Err(errno());
        }
        Ok(read as usize)
    }
    fn listpids(&mut self, out: &mut [u8]) -> Result<usize, NativeError> {
        let size = c_int::try_from(out.len()).map_err(|_| NativeError::InvalidData)?;
        // SAFETY: writable slice of `size` bytes, no retained pointer. Type1 is PROC_ALL_PIDS.
        let read = unsafe { proc_listpids(1, 0, out.as_mut_ptr().cast(), size) };
        if read <= 0 {
            return Err(errno());
        }
        Ok(read as usize)
    }
    fn boot_uuid(&mut self, out: &mut [u8]) -> Result<usize, NativeError> {
        let mut size = out.len();
        // SAFETY: static NUL-terminated name, writable slice and length pointer live
        // throughout the synchronous call; null new pointer and zero length make it read-only.
        let result = unsafe {
            sysctlbyname(
                c"kern.bootsessionuuid".as_ptr(),
                out.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if result != 0 {
            return Err(errno());
        }
        Ok(size)
    }
}
