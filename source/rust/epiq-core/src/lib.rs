//! The event-log hot path of epiq.
//!
//! One entry point, `call`, takes an operation name and its input bytes and
//! answers with bytes — JSON on both sides unless an op says otherwise. The
//! crate knows nothing about the host: the wasm facade in `wasm.rs` moves
//! bytes across the boundary and nothing else, so a native facade can be
//! added without touching anything here.

mod decode;
mod frame;
mod model;
mod ops;
mod order;
mod pairs;
mod store;
mod parse;
mod timeline;
mod times;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use ops::call;
