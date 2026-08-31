import fs from 'node:fs';
import {test as base, expect} from '@playwright/test';
import {handoffPathFor, type Handoff} from './handoff.js';

export const readHandoff = (workerIndex: number): Handoff =>
	JSON.parse(fs.readFileSync(handoffPathFor(workerIndex), 'utf8')) as Handoff;

export const test = base.extend<{
	appUrl: string;
	repoRoot: string;
	// A GUI served over a directory with no epiq project.
	bareAppUrl: string;
	bareRepoRoot: string;
	// Anything the page logged that indicates a crash. A blank screen is React
	// unmounting on an uncaught error, so asserting on visible content alone
	// would pass on a page that had already thrown.
	pageErrors: string[];
}>({
	appUrl: async ({page: _}, use, testInfo) => {
		await use(readHandoff(testInfo.parallelIndex).baseUrl);
	},

	repoRoot: async ({page: _}, use, testInfo) => {
		await use(readHandoff(testInfo.parallelIndex).repoRoot);
	},

	bareAppUrl: async ({page: _}, use, testInfo) => {
		await use(readHandoff(testInfo.parallelIndex).bareUrl);
	},

	bareRepoRoot: async ({page: _}, use, testInfo) => {
		await use(readHandoff(testInfo.parallelIndex).bareRepoRoot);
	},

	pageErrors: async ({page}, use) => {
		const errors: string[] = [];

		page.on('pageerror', error => errors.push(String(error)));
		page.on('console', message => {
			if (message.type() === 'error') errors.push(message.text());
		});

		await use(errors);
	},
});

export {expect};
