// The npm bins' bundle: every package inside, so `npm i epiq` installs no dependencies.
export const npmBuildOptions = root => ({
	absWorkingDir: root,
	entryPoints: {index: 'source/cli.ts', mcp: 'source/mcp/index.ts'},
	bundle: true,
	splitting: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	minify: true,
	outdir: 'dist',
	metafile: true,
	define: {'process.env.NODE_ENV': '"production"'},
	// The entries default NODE_ENV for an unbundled run; bundled, the define wins.
	logOverride: {'assign-to-define': 'silent'},
	alias: {'react-devtools-core': './source/scripts/react-devtools-stub.js'},
	// Bundled CommonJS packages call require(), which ESM output lacks.
	banner: {
		js: [
			'#!/usr/bin/env node',
			"import {createRequire as __epiqCreateRequire} from 'node:module';",
			'const require = __epiqCreateRequire(import.meta.url);',
		].join('\n'),
	},
});
