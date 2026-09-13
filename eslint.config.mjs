import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import {epiqPlugin} from './source/scripts/eslint-rules.mjs';

export default tseslint.config(
	{
		ignores: [
			'dist/**',
			'coverage/**',
			'node_modules/**',
			'source/scripts/*.mjs',
			// The wasm module, as one base64 string.
			'source/lib/native/epiq-core.wasm.ts',
			// Worktrees checked out inside the repo are other branches' code.
			'.claude/worktrees/**',
		],
	},

	js.configs.recommended,
	...tseslint.configs.recommended,

	{
		files: ['source/**/*.{ts,tsx}', 'globals.d.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {epiq: epiqPlugin},
		rules: {
			'epiq/no-raw-control-characters': 'error',
			'no-control-regex': 'off',
			'no-useless-assignment': 'off',
			'no-case-declarations': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-misused-promises': [
				'warn',
				{
					checksVoidReturn: false,
				},
			],
		},
	},
);
