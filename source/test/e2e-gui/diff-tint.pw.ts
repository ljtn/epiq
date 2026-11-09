import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {commitLinkedFiles} from './linked-commit.js';

// An added line's background, and the 90/10 blend of the diff's own background
// and addition colour, both read inside the shadow root the diff draws in. A
// source string, not a closure: the root tsconfig has no DOM lib.
const TINTS = `(() => {
	const find = root => {
		for (const element of root.querySelectorAll('*')) {
			if (element.shadowRoot) {
				const line = element.shadowRoot.querySelector(
					"[data-line][data-line-type='change-addition']",
				);
				if (line) return line;
				const inner = find(element.shadowRoot);
				if (inner) return inner;
			}
		}
		return null;
	};
	const line = find(document);
	if (!line) return null;
	const probe = document.createElement('div');
	probe.style.background =
		'color-mix(in lab, var(--diffs-bg) 90%, var(--diffs-addition-base))';
	line.append(probe);
	const expected = getComputedStyle(probe).backgroundColor;
	probe.remove();
	return {line: getComputedStyle(line).backgroundColor, expected};
})()`;

const channels = (color: string) =>
	(color.match(/-?[\d.]+/g) ?? []).slice(0, 3).map(Number);

const tints = (page: Page) =>
	page.evaluate<{line: string; expected: string} | null>(TINTS);

test('an added line wears a tenth of the addition colour, so its syntax reads', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Tinted ${Date.now()}`);
	commitLinkedFiles(repoRoot, ref, 'tinted lines', {
		[`tint-${ref}.ts`]: 'export const tinted = true;\n',
	});

	await page.goto(`${page.url().split('?')[0]}?tab=code`);
	await expect(page.locator('aside')).toContainText(`tint-${ref}.ts`);
	await expect.poll(() => tints(page)).not.toBeNull();

	const {line, expected} = (await tints(page))!;
	const [r1, g1, b1] = channels(line);
	const [r2, g2, b2] = channels(expected);
	for (const [a, b] of [
		[r1, r2],
		[g1, g2],
		[b1, b2],
	]) {
		expect(Math.abs(a! - b!), `${line} vs ${expected}`).toBeLessThanOrEqual(2);
	}

	expect(pageErrors).toEqual([]);
});
