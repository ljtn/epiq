// Node has had WebAssembly since 8, but lib "esnext" with types "node" does
// not declare it — the declaration lives in lib "dom", which the server code
// does not take. Only what core.ts touches.
declare namespace WebAssembly {
	class Module {
		constructor(bytes: Uint8Array);
	}

	class Memory {
		readonly buffer: ArrayBuffer;
	}

	class Instance {
		constructor(module: Module, imports?: Record<string, unknown>);
		readonly exports: Record<string, unknown>;
	}
}
