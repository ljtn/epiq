import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFile} from './linked-commit.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const expandDiff = async (page: Page, subject: string) => {
	await page.getByRole('button', {name: /^Commits/}).click();
	for (const name of [subject, 'notes.txt']) {
		const toggle = page.getByRole('button', {name});
		await expect(toggle).toBeVisible();
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
			await toggle.click();
		}
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	}
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the scrubber filter list stays above a diff header in the panel', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	// Short, so the panel has to scroll.
	await page.setViewportSize({width: 1280, height: 480});
	const stamp = Date.now();
	await addTicket(page, `Stacking ${stamp}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// Long enough that the panel can scroll its header up under the popover.
	commitLinkedFile(
		repoRoot,
		ref!,
		'add notes',
		'notes.txt',
		Array.from({length: 60}, (_, index) => `line ${index + 1}`).join('\n') +
			'\n',
	);
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Stacking ${stamp}`);
	await expandDiff(page, 'add notes');

	await page.getByText('All board events').click();
	await expect(page.getByRole('radiogroup')).toBeVisible();

	// The diff renders its own file header with a z-index inside a shadow
	// root. Scroll it under the popover and ask the browser which is on top.
	const onTop = await page.evaluate(`
(() => {
	const aside = document.querySelector('aside');
	const popover = document.querySelector('[role="radiogroup"]');
	const host = [...aside.querySelectorAll('*')].find(element =>
		element.shadowRoot?.querySelector('[data-diffs-header]'),
	);
	const header = host.shadowRoot.querySelector('[data-diffs-header]');

	const popoverBox = popover.getBoundingClientRect();
	aside.scrollTop +=
		header.getBoundingClientRect().top -
		(popoverBox.top + popoverBox.height / 2);

	const headerBox = header.getBoundingClientRect();
	const left = Math.max(popoverBox.left, headerBox.left);
	const right = Math.min(popoverBox.right, headerBox.right);
	const top = Math.max(popoverBox.top, headerBox.top);
	const bottom = Math.min(popoverBox.bottom, headerBox.bottom);
	if (right <= left || bottom <= top) return 'no overlap';

	const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
	return popover.contains(hit) ? 'popover' : hit?.tagName ?? 'nothing';
})()
`);
	expect(onTop).toBe('popover');

	expect(pageErrors).toEqual([]);
});

test('entering fullscreen lays the panel out for its full width in the same frame', async ({
	page,
	pageErrors,
}) => {
	await page.setViewportSize({width: 1600, height: 900});
	await addTicket(page, `Frame ${Date.now()}`);
	await expect(page.getByTestId('lane-overview')).toHaveCount(0);

	// Observes the panel going fullscreen and reads the layout in that same
	// commit: the lanes must already be there, not arrive a render later after
	// a frame of tabs stretched across the window.
	const lanesWhenFullscreen = await page.evaluate(`
new Promise(resolve => {
	const aside = document.querySelector('aside');
	const observer = new MutationObserver(() => {
		if (getComputedStyle(aside).position !== 'absolute') return;
		observer.disconnect();
		resolve(document.querySelectorAll('[data-testid="lane-overview"]').length);
	});
	observer.observe(aside, {attributes: true, attributeFilter: ['style']});
	aside.querySelector('button[title="Fullscreen"]').click();
})
`);
	expect(lanesWhenFullscreen).toBe(1);
	await expect(page.getByTestId('lane-overview')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
