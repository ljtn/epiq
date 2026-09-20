#!/usr/bin/env node
// Copies the GUI's static assets into dist/gui and bundles its client code.
// Uses Node's fs APIs rather than `mkdir -p`/`cp`, which cmd.exe doesn't have.

import {mkdirSync, copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

mkdirSync(resolve(root, 'dist/gui'), {recursive: true});
copyFileSync(
	resolve(root, 'source/gui/index.html'),
	resolve(root, 'dist/gui/index.html'),
);
copyFileSync(
	resolve(root, 'source/gui/favicon.ico'),
	resolve(root, 'dist/gui/favicon.ico'),
);

// React reads `process.env.NODE_ENV` to decide which of its two runtimes it is.
// Nothing defined it, so esbuild left the expression alone and the bundle got
// the development one — bigger, and slower at every render, because each one
// pays the dev-only checks. Defining it picks the production runtime;
// minifying takes the rest. Together: main.js 3.22mb -> 1.20mb.
//
// EPIQ_GUI_DEV_BUILD=1 asks for the development one back. React's warnings — a
// style shorthand fighting a longhand, a missing key, invalid DOM nesting —
// exist only there, and `source/test/e2e-gui/fixtures.ts` fails a test on any
// console.error, so that pair is how those get caught. The production bundle is
// what ships and what the suite runs against by default.
const nodeEnv =
	process.env['EPIQ_GUI_DEV_BUILD'] === '1' ? 'development' : 'production';

// The API rather than the CLI: a define's value is JSON, so `"production"`
// carries quotes that a Windows shell would eat before esbuild saw them.
await esbuild.build({
	absWorkingDir: root,
	entryPoints: ['source/gui/client/main.tsx'],
	bundle: true,
	// Splitting rather than a single outfile: @pierre/diffs pulls in Shiki's
	// full bundled-language and theme set, which a single-file bundle inlines
	// wholesale (~12mb) regardless of which languages actually render. Splitting
	// lets each language/theme load lazily as its own chunk, only when a diff
	// actually needs it. serveStatic (api-server.ts) already serves any path
	// under dist/gui, and build-sea.mjs embeds the directory's full contents —
	// both already account for a chunked output, not just main.js.
	splitting: true,
	format: 'esm',
	target: 'es2020',
	outdir: 'dist/gui',
	minify: nodeEnv === 'production',
	define: {'process.env.NODE_ENV': JSON.stringify(nodeEnv)},
	logLevel: 'info',
});
