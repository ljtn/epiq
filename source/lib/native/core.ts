// The host side of the epiq-core wasm boundary.
//
// One call shape: an op name and input bytes in, answer bytes out. Every op
// answers JSON, and a failure is `{"error": "..."}`, which becomes a failed
// Result here so callers never see the boundary.
//
// The module is embedded as base64 (see build-rust.mjs) and instantiated on
// first use, synchronously: the loaders it sits behind are synchronous, and a
// module this size compiles in a few milliseconds.
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {EPIQ_CORE_WASM_BASE64} from './epiq-core.wasm.js';

type CoreExports = {
	memory: WebAssembly.Memory;
	epiq_alloc: (len: number) => number;
	epiq_free: (ptr: number, len: number) => void;
	epiq_call: (
		opPtr: number,
		opLen: number,
		inPtr: number,
		inLen: number,
	) => number;
};

let instance: CoreExports | null = null;

const instantiate = (): CoreExports => {
	if (instance) return instance;

	const bytes = Buffer.from(EPIQ_CORE_WASM_BASE64, 'base64');
	const module = new WebAssembly.Module(bytes);
	const {exports} = new WebAssembly.Instance(module, {});

	instance = exports as CoreExports;

	return instance;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A view is only valid until the next allocation: growing the memory detaches
// the buffer behind every existing view.
const writeInto = (wasm: CoreExports, bytes: Uint8Array): number => {
	if (bytes.length === 0) return 0;

	const ptr = wasm.epiq_alloc(bytes.length);
	new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);

	return ptr;
};

/**
 * Calls one op. A trap inside the module (a panic aborts) leaves its allocator
 * in an unknown state, so the instance is dropped and the next call starts a
 * fresh one.
 */
export const coreCall = (
	op: string,
	input: Uint8Array | string,
): Result<Uint8Array> => {
	let wasm: CoreExports;

	try {
		wasm = instantiate();
	} catch (error) {
		return failed(
			`epiq-core failed to load: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const opBytes = encoder.encode(op);
	const inBytes = typeof input === 'string' ? encoder.encode(input) : input;

	try {
		const opPtr = writeInto(wasm, opBytes);
		const inPtr = writeInto(wasm, inBytes);
		const outPtr = wasm.epiq_call(opPtr, opBytes.length, inPtr, inBytes.length);

		const length = new DataView(wasm.memory.buffer).getUint32(outPtr, true);
		// Copied out before the allocation goes back.
		const out = new Uint8Array(wasm.memory.buffer, outPtr + 4, length).slice();

		wasm.epiq_free(outPtr, length + 4);

		return succeeded(`epiq-core ${op}`, out);
	} catch (error) {
		instance = null;

		return failed(
			`epiq-core ${op} failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};

/** An op whose answer is a JSON document; an `error` document is a failure. */
export const coreCallJson = <T>(
	op: string,
	input: Uint8Array | string,
): Result<T> => {
	const result = coreCall(op, input);
	if (isFail(result)) return failed(result.message);

	let doc: unknown;

	try {
		doc = JSON.parse(decoder.decode(result.value));
	} catch (error) {
		return failed(
			`epiq-core ${op} answered malformed JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (
		typeof doc === 'object' &&
		doc !== null &&
		'error' in doc &&
		typeof (doc as {error: unknown}).error === 'string'
	) {
		return failed(`epiq-core ${op}: ${(doc as {error: string}).error}`);
	}

	return succeeded(`epiq-core ${op}`, doc as T);
};
