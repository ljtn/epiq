import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const suiteDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'e2e-gui',
);

// Specs where reading a `title` is the point.
const allowed = new Set(['tooltip.pw.ts', 'issue-stats.pw.ts']);

describe('the GUI suite does not find controls by their title', () => {
	// `TooltipLayer` removes `title` while its tooltip is open, so a title
	// locator can match the wrong control. Specs locate by `testId`.
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
