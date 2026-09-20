#!/usr/bin/env node
// Copies the GUI's static assets into dist/gui and bundles its client code.
// Uses Node's fs APIs rather than `mkdir -p`/`cp`, which cmd.exe doesn't have.

import {mkdirSync, copyFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, relative, resolve} from 'node:path';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

// The diff highlighter's worker body, as the package's own exports map gives
// it — `@pierre/diffs` ships the body but cannot ship a URL the browser can
// fetch, since that depends on how the app is bundled. Resolved rather than
// spelled out, so a move inside the package is the package's business.
//
// An entry point rather than a module of ours importing it: the package
// declares itself side-effect-free, so a bare `import '…/worker.js'` is
// tree-shaken to nothing. An entry point never is.
//
// `import.meta.resolve`, not `createRequire().resolve` — the subpath is
// exported under `import` only, which a require resolution does not see.
const diffsWorkerEntry = relative(
	root,
	fileURLToPath(import.meta.resolve('@pierre/diffs/worker/worker.js')),
);

// Emptied first: every lazily-loaded chunk carries a content hash in its name,
// so a rebuild leaves the previous build's set behind rather than replacing it,
// and `build-sea.mjs` embeds whatever it finds in this directory. Nothing is
// served stale — the names a browser asks for are fixed — but the blob carries
// a dead copy of every chunk that ever changed.
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

// React reads `process.env.NODE_ENV` to decide which of its two runtimes it is.
// Nothing defined it, so esbuild left the expression alone and the bundle got
// the development one — bigger, and slower at every render, because each one
// pays the dev-only checks. Defining it picks the production runtime;
// minifying takes the rest. Together: main.js 3.22mb -> 1.20mb.
//
// EPIQ_GUI_DEV_BUILD=1 asks for the development one back — `npm run
// test:gui:warnings` is that build plus the browser suite. React's warnings — a
// style shorthand fighting a longhand, a missing key, invalid DOM nesting —
// exist only in the development runtime, and `source/test/e2e-gui/fixtures.ts`
// fails a test on any console.error, so that pair is the only thing that
// catches them. The production bundle is what ships and what the gate runs
// against, so the warning pass is a deliberate, separate run.
const nodeEnv =
	process.env['EPIQ_GUI_DEV_BUILD'] === '1' ? 'development' : 'production';

// The API rather than the CLI: a define's value is JSON, so `"production"`
// carries quotes that a Windows shell would eat before esbuild saw them.
await esbuild.build({
	absWorkingDir: root,
	// The worker is built beside the client rather than in a run of its own, so
	// the Shiki grammars both of them load on demand are one set of chunks
	// rather than two. `lib/diffs-worker-pool` points a `new Worker()` at the
	// name given here.
	entryPoints: [
		{in: 'source/gui/client/main.tsx', out: 'main'},
		{in: diffsWorkerEntry, out: 'diffs-worker'},
	],
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
