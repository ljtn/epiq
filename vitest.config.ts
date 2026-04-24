import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
		},
	},
});
