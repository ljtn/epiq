// Instantiates the built wasm module and calls it once, on whatever Node runs
// this: what the Node 18 leg of CI checks, since `engines.node >= 18` and the
// module is the one thing a Node that old could refuse. No TypeScript, no
// test runner — those want a newer Node than the one under test.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const moduleFile = new URL(
	'../lib/native/epiq-core.wasm.ts',
	import.meta.url,
);
const source = fs.readFileSync(fileURLToPath(moduleFile), 'utf8');
const base64 = /EPIQ_CORE_WASM_BASE64 =\s*'([^']+)'/.exec(source)?.[1];

if (!base64) {
	console.error('epiq-core.wasm.ts holds no module; run npm run build:rust');
	process.exit(1);
}

const {exports} = new WebAssembly.Instance(
	new WebAssembly.Module(Buffer.from(base64, 'base64')),
	{},
);

const encoder = new TextEncoder();
const write = bytes => {
	const ptr = exports.epiq_alloc(bytes.length);
	new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
	return ptr;
};

const op = encoder.encode('ping');
const input = encoder.encode(`node ${process.version}`);
const out = exports.epiq_call(write(op), op.length, write(input), input.length);
const length = new DataView(exports.memory.buffer).getUint32(out, true);
const answer = JSON.parse(
	new TextDecoder().decode(
		new Uint8Array(exports.memory.buffer, out + 4, length),
	),
);
exports.epiq_free(out, length + 4);

if (answer.pong !== `node ${process.version}`) {
	console.error('unexpected answer', answer);
	process.exit(1);
}

console.log(`epiq-core answers on ${process.version}: ${JSON.stringify(answer)}`);
