import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const suiteDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'e2e-gui',
);

// Where reading a `title` is the point rather than a way of finding something:
// `tooltip.pw.ts` is about the attribute's whole lifecycle, and `issue-stats`
// checks the share a language bar names.
const allowed = new Set(['tooltip.pw.ts', 'issue-stats.pw.ts']);

describe('the GUI suite does not find controls by their title', () => {
	// `TooltipLayer` parks the `title` — `removeAttribute('title')` — while its
	// own tooltip is open, 500ms after the pointer arrives, and a Playwright
	// click leaves the pointer on what it clicked. So a title locator silently
	// stops matching the control it names for as long as somebody rests on it,
	// and `.first()` then resolves to the *next* match instead.
	//
	// That cost four specs a place on the flaky list and failed two CI runs of
	// PR 355 outright. Controls the suite drives carry a `testId`; this keeps
	// the next one from going back to the title.
	const offenders = fs
		.readdirSync(suiteDir)
		.filter(name => name.endsWith('.pw.ts') && !allowed.has(name))
		.filter(name =>
			fs
				.readFileSync(path.join(suiteDir, name), 'utf8')
				.includes('getByTitle('),
		);

	it('locates them by a name the pointer cannot take away', () => {
		expect(offenders).toEqual([]);
	});
});
