import * as esbuild from 'esbuild';

const context = await esbuild.context({
	entryPoints: {index: 'source/cli.ts', mcp: 'source/mcp/index.ts'},
	bundle: true,
	splitting: true,
	packages: 'external',
	platform: 'node',
	format: 'esm',
	target: 'node18',
	minify: true,
	outdir: 'dist',
	banner: {
		js: '#!/usr/bin/env node',
	},
});

await context.watch();

console.log('Watching npm build...');
