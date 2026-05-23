import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
		},
		globalSetup: './source/test/e2e/e2e-setup.ts',
		testTimeout: 20_000,
	},
});
