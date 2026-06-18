#!/usr/bin/env node
// Builds a Node.js Single Executable Application (SEA) for the epiq CLI.
//
// Why this approach:
//   Node.js SEA only supports CJS entry points, but ink and yoga-layout use
//   top-level await which CJS can't express. The workaround is to bundle the
//   app as ESM, then wrap it in a tiny CJS bootstrap that loads it via a
//   data: URL (Node.js resolves node: built-ins from data: URLs).
//
//   react-devtools-core is a dev-only optional dep that ink tries to import
//   statically. We stub it so the bundle is fully self-contained.

import {execSync, execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, copyFileSync, chmodSync} from 'node:fs';
import {mkdirSync} from 'node:fs';
import {platform} from 'node:process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const esbuild = resolve(root, 'node_modules/.bin/esbuild');

function run(cmd, opts = {}) {
	console.log(`> ${cmd}`);
	execSync(cmd, {cwd: root, stdio: 'inherit', ...opts});
}

function runBin(bin, args, opts = {}) {
	console.log(`> ${bin} ${args.join(' ')}`);
	execFileSync(bin, args, {cwd: root, stdio: 'inherit', ...opts});
}

mkdirSync(resolve(root, 'dist'), {recursive: true});

// 1. Bundle to ESM (supports top-level await; react-devtools-core is stubbed)
console.log('\n[1/6] Bundling to ESM...');
runBin(esbuild, [
	'source/Index.tsx',
	'--bundle',
	'--platform=node',
	'--format=esm',
	'--target=node22',
	'--minify',
	'--alias:react-devtools-core=./source/scripts/react-devtools-stub.js',
	'--outfile=dist/sea-inner.js',
]);

// 2. Patch the ESM bundle:
//    a) Inject a `require` shim — esbuild emits a CJS-compat shim that
//       falls back to throwing when `require` is undefined (which it is in
//       ESM/data-URL context). We supply a real one via createRequire.
//    b) Patch import.meta.url so meow resolves package.json from the
//       executable location rather than the data: URL.
console.log('\n[2/6] Patching bundle...');
let inner = readFileSync(resolve(root, 'dist/sea-inner.js'), 'utf8');

const requireShim = [
	'import { createRequire as __cjsCreateRequire } from "node:module";',
	'const require = __cjsCreateRequire(process.env.__EPIQ_SEA_URL__ || "file:///");',
	'',
].join('\n');
inner = requireShim + inner;

// Use a placeholder so the two replacements don't interfere.
// In the SEA binary process.env.__EPIQ_SEA_URL__ is always set by the CJS
// bootstrap before the import() call, so no fallback is needed.
const PH = '__EPIQ_IMPORT_META_URL__';
inner = inner.replace(/\bimport\.meta\.url\b/g, PH);
// Replace any remaining standalone import.meta with a synthetic object.
inner = inner.replace(/\bimport\.meta\b/g, `{url:${PH}}`);
// Expand the placeholder to the actual runtime expression.
inner = inner.replace(new RegExp(PH, 'g'), 'process.env.__EPIQ_SEA_URL__');

writeFileSync(resolve(root, 'dist/sea-inner.js'), inner);

// 3. Wrap the ESM bundle in a CJS bootstrap.
//    The bootstrap sets __EPIQ_SEA_URL__ so the patched import.meta.url
//    inside the ESM module gets a file:// URL pointing to the executable.
console.log('\n[3/6] Creating CJS bootstrap...');
const esmCode = readFileSync(resolve(root, 'dist/sea-inner.js'), 'utf8');
const b64 = Buffer.from(esmCode).toString('base64');
const cjsWrapper = `'use strict';
const {pathToFileURL} = require('node:url');
process.env.__EPIQ_SEA_URL__ = pathToFileURL(process.execPath).href;
(async () => {
  await import('data:application/javascript;base64,${b64}');
})().catch(err => { console.error(err); process.exit(1); });
`;
writeFileSync(resolve(root, 'dist/sea.cjs'), cjsWrapper);

// 4. Generate SEA blob
console.log('\n[4/6] Generating SEA blob...');
run(`node --experimental-sea-config source/config/sea-config.json`);

// 5. Assemble the binary
console.log('\n[5/6] Assembling binary...');
const outBin = resolve(root, 'dist/epiq');
copyFileSync(process.execPath, outBin);
chmodSync(outBin, 0o755);

if (platform === 'darwin') {
	run(`codesign --remove-signature ${outBin}`);
}

run(
	`npx --yes postject ${outBin} NODE_SEA_BLOB dist/sea.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    ${platform === 'darwin' ? '--macho-segment-name NODE_SEA' : ''}`,
);

if (platform === 'darwin') {
	run(`codesign --sign - ${outBin}`);
}

// 6. Verify
console.log('\n[6/6] Verifying...');
run(`${outBin} --version`);

console.log(`\nDone! Binary at dist/epiq`);
