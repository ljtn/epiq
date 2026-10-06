import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {commitLinkedFiles} from './linked-commit.js';

// The diff draws inside shadow roots, so its scrollers are counted there. A
// source string, not a closure: the root tsconfig has no DOM lib.
const SIDEWAYS_SCROLLERS = `(() => {
	let count = 0;
	const walk = (root, inShadow) => {
		for (const element of root.querySelectorAll('*')) {
			const {overflowX} = getComputedStyle(element);
			if (
				inShadow &&
				(overflowX === 'auto' || overflowX === 'scroll') &&
				element.scrollWidth > element.clientWidth + 1
			) count += 1;
			if (element.shadowRoot) walk(element.shadowRoot, true);
		}
	};
	walk(document, false);
	return count;
})()`;

const sidewaysScrollers = (page: Page) =>
	page.evaluate<number>(SIDEWAYS_SCROLLERS);

// Each file scrolls sideways on its own, so its scrollbar sits at the foot of
// the file, out of sight below a long one. Wrapped, there is nothing to scroll.
test('the Wrap toggle wraps long diff lines, and is remembered', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Wide lines ${Date.now()}`);
	const wide = `${Array.from(
		{length: 40},
		(_, line) => `const value${line} = "${'x'.repeat(300)}";`,
	).join('\n')}\n`;
	commitLinkedFiles(repoRoot, ref, 'wide lines', {[`wide-${ref}.ts`]: wide});

	await page.goto(`${page.url().split('?')[0]}?tab=code`);
	const well = page.getByTestId('diff-wrap');
	const scroll = well.getByRole('button', {name: 'Scroll long lines'});
	const wrapLines = well.getByRole('button', {name: 'Wrap long lines'});
	await expect(scroll).toHaveAttribute('aria-pressed', 'true');
	await expect(wrapLines).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => sidewaysScrollers(page)).toBeGreaterThan(0);

	await wrapLines.click();
	await expect(wrapLines).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => sidewaysScrollers(page)).toBe(0);

	await page.reload();
	await expect(wrapLines).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('aside')).toContainText(`wide-${ref}.ts`);
	await expect.poll(() => sidewaysScrollers(page)).toBe(0);

	await scroll.click();
	await expect(scroll).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => sidewaysScrollers(page)).toBeGreaterThan(0);

	expect(pageErrors).toEqual([]);
});
