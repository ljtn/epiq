import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	COMMIT_CACHE_MS,
	commitLinkedFile,
	linkedFileName,
} from './linked-commit.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

// The highlighter fills its shadow root asynchronously, and `aria-expanded` on
// the file's own toggle says nothing about that. Measuring before it lands
// finds no host at all, which reads as a broken test rather than a broken
// feature — so wait for the header itself.
const waitForDiffHeader = async (page: Page) => {
	await page.waitForFunction(`
		[...document.querySelector('aside').querySelectorAll('*')].some(element =>
			element.shadowRoot?.querySelector('[data-diffs-header]'),
		)
	`);
};

const expandDiff = async (page: Page, subject: string, fileName: string) => {
	await page.getByRole('button', {name: /^Commits/}).click();
	for (const name of [subject, fileName]) {
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
		linkedFileName(ref!),
		Array.from({length: 60}, (_, index) => `line ${index + 1}`).join('\n') +
			'\n',
	);
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Stacking ${stamp}`);
	await expandDiff(page, 'add notes', linkedFileName(ref!));

	await waitForDiffHeader(page);

	await page.getByRole('button', {name: 'Board events'}).click();
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
	const pane = aside.querySelector('[data-testid="aside-pane"]');

	const popoverBox = popover.getBoundingClientRect();
	pane.scrollTop +=
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

test('a diff keeps its file name in view while the panel scrolls past it', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	// Short, so the panel has to scroll.
	await page.setViewportSize({width: 1280, height: 480});
	const stamp = Date.now();
	await addTicket(page, `Sticky ${stamp}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// Long enough to outlast its own header on the way past.
	commitLinkedFile(
		repoRoot,
		ref!,
		'add notes',
		linkedFileName(ref!),
		Array.from({length: 60}, (_, index) => `line ${index + 1}`).join('\n') +
			'\n',
	);
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Sticky ${stamp}`);
	await expandDiff(page, 'add notes', linkedFileName(ref!));
	await waitForDiffHeader(page);

	// Scrolls the diff's own top out of the panel and asks where its header
	// ended up. It lives in a shadow root, so there is no locator for it.
	const pinned = (await page.evaluate(`
(() => {
	const aside = document.querySelector('aside');
	const host = [...aside.querySelectorAll('*')].find(element =>
		element.shadowRoot?.querySelector('[data-diffs-header]'),
	);
	const header = host.shadowRoot.querySelector('[data-diffs-header]');
	// The pane inside the panel is what scrolls, and its top is where anything
	// pinned to the top of the panel belongs.
	const pane = aside.querySelector('[data-testid="aside-pane"]');
	const scrollportTop = pane.getBoundingClientRect().top;

	pane.scrollTop += host.getBoundingClientRect().top - scrollportTop + 60;

	const headerBox = header.getBoundingClientRect();
	return {
		fileName: header.textContent.trim(),
		// Negative: the diff itself has started leaving the panel.
		hostTop: Math.round(host.getBoundingClientRect().top - scrollportTop),
		headerTop: Math.round(headerBox.top - scrollportTop),
		headerBottom: Math.round(headerBox.bottom - scrollportTop),
	};
})()
`)) as {
		fileName: string;
		hostTop: number;
		headerTop: number;
		headerBottom: number;
	};

	expect(pinned.fileName).toContain(linkedFileName(ref!));
	expect(pinned.hostTop).toBeLessThan(0);
	// Pinned against the panel's top edge rather than carried off with the box.
	expect(pinned.headerTop).toBeGreaterThanOrEqual(0);
	expect(pinned.headerTop).toBeLessThanOrEqual(2);
	expect(pinned.headerBottom).toBeGreaterThan(pinned.headerTop);

	expect(pageErrors).toEqual([]);
});

// The same panel docked the other way, on a window too narrow for the lanes —
// so the tabs scroll, and it is this pane doing it rather than a lane's own.
test('a bottom-docked panel pins the file name too', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	await page.setViewportSize({width: 1280, height: 720});
	const stamp = Date.now();
	await addTicket(page, `Docked ${stamp}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFile(
		repoRoot,
		ref!,
		'add notes',
		linkedFileName(ref!),
		Array.from({length: 60}, (_, index) => `line ${index + 1}`).join('\n') +
			'\n',
	);
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Docked ${stamp}`);

	await page.getByTestId('panel-menu').click();
	await page.getByRole('button', {name: 'Dock to bottom'}).click();
	await expect(page.getByTestId('lane-overview')).toHaveCount(0);

	await expandDiff(page, 'add notes', linkedFileName(ref!));
	await waitForDiffHeader(page);

	const headerTop = await page.evaluate(`
(() => {
	const aside = document.querySelector('aside');
	const pane = aside.querySelector('[data-testid="aside-pane"]');
	const host = [...aside.querySelectorAll('*')].find(element =>
		element.shadowRoot?.querySelector('[data-diffs-header]'),
	);
	const header = host.shadowRoot.querySelector('[data-diffs-header]');
	const scrollportTop = pane.getBoundingClientRect().top;

	pane.scrollTop += host.getBoundingClientRect().top - scrollportTop + 60;

	return Math.round(
		header.getBoundingClientRect().top - scrollportTop,
	);
})()
`);

	expect(headerTop).toBeGreaterThanOrEqual(0);
	expect(headerTop).toBeLessThanOrEqual(2);

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
