import * as esbuild from 'esbuild';

const shared = {
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm',
	target: 'node18',
	minify: true,
	banner: {
		js: '#!/usr/bin/env node',
	},
};

const index = await esbuild.context({
	...shared,
	entryPoints: {index: 'source/cli.ts'},
	splitting: true,
	outdir: 'dist',
});

const mcp = await esbuild.context({
	...shared,
	entryPoints: ['source/mcp/index.ts'],
	outfile: 'dist/mcp.js',
});

await index.watch();
await mcp.watch();

console.log('Watching npm build...');
