#!/usr/bin/env node
// Copies the GUI's static assets into dist/gui and bundles its client code.
// Uses Node's fs APIs rather than `mkdir -p`/`cp`, which cmd.exe doesn't have.

import {mkdirSync, copyFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, relative, resolve} from 'node:path';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

// The diff highlighter's worker body, built as its own entry point since the
// package is side-effect-free. `import.meta.resolve`, as the subpath is
// exported under `import` only.
const diffsWorkerEntry = relative(
	root,
	fileURLToPath(import.meta.resolve('@pierre/diffs/worker/worker.js')),
);

// Emptied first: chunk names are hashed, and `build-sea.mjs` embeds every
// file here.
rmSync(resolve(root, 'dist/gui'), {recursive: true, force: true});
mkdirSync(resolve(root, 'dist/gui'), {recursive: true});
copyFileSync(
	resolve(root, 'source/gui/index.html'),
	resolve(root, 'dist/gui/index.html'),
);
copyFileSync(
	resolve(root, 'source/gui/favicon.ico'),
	resolve(root, 'dist/gui/favicon.ico'),
);
// Flat beside the rest: build-sea.mjs embeds this directory's top level only.
// The licence goes with it, since the font's own metadata does not carry it.
for (const name of ['inter.woff2', 'inter-OFL.txt']) {
	copyFileSync(
		resolve(root, 'source/gui/fonts', name),
		resolve(root, 'dist/gui', name),
	);
}

// Production React unless EPIQ_GUI_DEV_BUILD=1, which `test:gui:warnings`
// uses to surface React's dev-only warnings.
const nodeEnv =
	process.env['EPIQ_GUI_DEV_BUILD'] === '1' ? 'development' : 'production';

// The API rather than the CLI: a define's value is JSON, so `"production"`
// carries quotes that a Windows shell would eat before esbuild saw them.
await esbuild.build({
	absWorkingDir: root,
	// Built beside the client so both share one set of grammar chunks.
	// `lib/diffs-worker-pool` loads it by the name given here.
	entryPoints: [
		{in: 'source/gui/client/main.tsx', out: 'main'},
		{in: diffsWorkerEntry, out: 'diffs-worker'},
	],
	bundle: true,
	// Split so each Shiki language and theme loads lazily as its own chunk.
	splitting: true,
	format: 'esm',
	target: 'es2020',
	outdir: 'dist/gui',
	minify: nodeEnv === 'production',
	define: {'process.env.NODE_ENV': JSON.stringify(nodeEnv)},
	logLevel: 'info',
});
