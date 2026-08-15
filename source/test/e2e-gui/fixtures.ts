import fs from 'node:fs';
import {test as base, expect} from '@playwright/test';
import {HANDOFF_PATH, type Handoff} from './handoff.js';

const readHandoff = (): Handoff =>
	JSON.parse(fs.readFileSync(HANDOFF_PATH, 'utf8')) as Handoff;

export const test = base.extend<{
	appUrl: string;
	// Anything the page logged that indicates a crash. A blank screen is React
	// unmounting on an uncaught error, so asserting on visible content alone
	// would pass on a page that had already thrown.
	pageErrors: string[];
}>({
	appUrl: async ({page: _}, use) => {
		await use(readHandoff().baseUrl);
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
