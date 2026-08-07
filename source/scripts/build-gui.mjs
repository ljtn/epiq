#!/usr/bin/env node
// Copies the GUI's static assets into dist/gui and bundles its client code.
// Uses Node's fs APIs rather than `mkdir -p`/`cp`, which cmd.exe doesn't have.

import {execFileSync} from 'node:child_process';
import {mkdirSync, copyFileSync} from 'node:fs';
import {platform} from 'node:process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
// On Windows npm installs `esbuild.cmd` in .bin (no extensionless shim).
const esbuildBin = platform === 'win32' ? 'esbuild.cmd' : 'esbuild';
const esbuild = resolve(root, 'node_modules/.bin', esbuildBin);

mkdirSync(resolve(root, 'dist/gui'), {recursive: true});
copyFileSync(
	resolve(root, 'source/gui/index.html'),
	resolve(root, 'dist/gui/index.html'),
);
copyFileSync(
	resolve(root, 'source/gui/favicon.ico'),
	resolve(root, 'dist/gui/favicon.ico'),
);

execFileSync(
	esbuild,
	[
		'source/gui/client/main.tsx',
		'--bundle',
		'--format=esm',
		'--target=es2020',
		'--outfile=dist/gui/main.js',
	],
	{cwd: root, stdio: 'inherit', shell: platform === 'win32'},
);
