import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'dist/**',
			'coverage/**',
			'node_modules/**',
			'source/scripts/*.mjs',
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
		rules: {
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
