//! The wasm boundary: three exports and one buffer convention.
//!
//! The host allocates input with `epiq_alloc`, writes into it, and hands the
//! pointer to `epiq_call`, which takes the allocation back. The answer comes
//! as a pointer to `[u32 little-endian length][bytes]`; the host copies the
//! bytes out and returns the whole allocation with `epiq_free`.

use std::alloc::{alloc, dealloc, Layout};

#[no_mangle]
pub extern "C" fn epiq_alloc(len: u32) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }

    let layout = Layout::from_size_align(len as usize, 1).expect("a byte layout");

    // SAFETY: a non-zero, byte-aligned layout.
    unsafe { alloc(layout) }
}

#[no_mangle]
pub extern "C" fn epiq_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() || len == 0 {
        return;
    }

    let layout = Layout::from_size_align(len as usize, 1).expect("a byte layout");

    // SAFETY: only ever called by the host with a pointer and length this
    // module handed out together.
    unsafe { dealloc(ptr, layout) }
}

unsafe fn bytes_at<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        return &[];
    }

    std::slice::from_raw_parts(ptr, len as usize)
}

#[no_mangle]
pub extern "C" fn epiq_call(
    op_ptr: *const u8,
    op_len: u32,
    in_ptr: *mut u8,
    in_len: u32,
) -> *mut u8 {
    // SAFETY: both regions were allocated by `epiq_alloc` for exactly these
    // lengths and are not touched by the host until this returns. An empty
    // input has no allocation behind it, so it never becomes a slice.
    let op = unsafe { bytes_at(op_ptr, op_len) };
    let input = unsafe { bytes_at(in_ptr, in_len) };

    let op = std::str::from_utf8(op).unwrap_or("");
    let answer = crate::call(op, input);

    epiq_free(op_ptr as *mut u8, op_len);
    epiq_free(in_ptr, in_len);

    let len = answer.len() as u32;
    let total = len as usize + 4;
    let out = epiq_alloc(total as u32);

    // SAFETY: `out` is a fresh allocation of `total` bytes.
    unsafe {
        std::ptr::copy_nonoverlapping(len.to_le_bytes().as_ptr(), out, 4);
        std::ptr::copy_nonoverlapping(answer.as_ptr(), out.add(4), answer.len());
    }

    out
}
