// The identity panel: who the board thinks you are, which git addresses are
// yours, and the states nothing else reports.

import fs from 'node:fs';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {expect, readHandoff, test} from './fixtures.js';
import {addTicket} from './ticket.js';
import {commitLinkedFile, linkedFileName} from './linked-commit.js';

// The seeded user and `commitLinkedFile`'s address, deliberately unalike.
const BOARD_NAME = 'claude/tester';
// What the panel draws: a board name is shown from its last slash, so the two
// `claude/...` sessions on a board are told apart without the prefix repeating.
const SHOWN_NAME = '/tester';
const COMMIT_EMAIL = 'e2e@example.com';

/** The panel, opened from the avatar, with the viewer's own stats unfolded. */
const openPanel = async (page: Page) => {
	await page.getByTestId('open-settings').click();

	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();
	await expand(page, 'identity');
	await expect(panel.getByTestId('identity-panel')).toBeVisible();
	return panel;
};

/** A section is folded unless the panel was opened for it. */
const expand = async (
	page: Page,
	section: 'identity' | 'sync' | 'addresses',
) => {
	const fold = page.getByTestId(`settings-section-${section}`);
	if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
	await expect(fold).toHaveAttribute('aria-expanded', 'true');
};

const expandSync = async (page: Page) => {
	await expand(page, 'sync');
	await expect(page.getByTestId('autosync-interval')).toBeVisible();
};

const expandAddresses = async (page: Page) => {
	await expand(page, 'addresses');
	await expect(page.getByTestId('identity-addresses')).toBeVisible();
};

/** A commit by `COMMIT_EMAIL`, and a page that can see it. */
const commitAndReload = async (page: Page, repoRoot: string, tag: string) => {
	await addTicket(page, `Identity ${tag}`);

	const ref = (
		await page.locator('aside').getByTestId('copy-ref').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFile(repoRoot, ref!, `identity ${tag}`, linkedFileName(ref!));
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	return ref!;
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the avatar opens settings, names who you are, and Escape closes it', async ({
	page,
	pageErrors,
}) => {
	await expect(page.getByTestId('identity-panel')).toHaveCount(0);

	await page.getByTestId('open-settings').click();
	const panel = page.getByTestId('settings-panel');
	// Focus moves into the panel, so Tab walks it rather than the page.
	await expect(panel).toBeFocused();
	// Who the board takes the viewer for, without unfolding anything.
	await expect(panel.getByTestId('settings-summary-identity')).toContainText(
		SHOWN_NAME,
	);
	await expand(page, 'identity');
	await expect(panel.getByTestId('identity-panel')).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('identity-panel')).toHaveCount(0);
	// And comes back to what opened it.
	await expect(page.getByTestId('open-settings')).toBeFocused();

	expect(pageErrors).toEqual([]);
});

// The panel is its own root, not inside the avatar, so inside clicks must be told apart.
test('a click inside the panel does not dismiss it', async ({
	page,
	pageErrors,
}) => {
	const panel = await openPanel(page);

	// The inert figures, so the click lands but triggers nothing.
	await panel.getByTestId('identity-stats').click();
	await expect(panel).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The follow notice sits inside the topbar, so it moves nothing: the panel
// below the bar stays where it is as the notice comes and goes.
test('the panel stays put as the follow notice comes and goes', async ({
	page,
	pageErrors,
}) => {
	const panel = await openPanel(page);
	const before = (await panel.boundingBox())!.y;

	// A click event alone: the dismiss listens for the press, and the panel is
	// meant to stay.
	await page.getByTestId('live-toggle').dispatchEvent('click');
	const notice = page.getByTestId('follow-banner');
	await expect(notice).toBeVisible();
	expect((await panel.boundingBox())!.y).toBeCloseTo(before, 0);

	await page.getByTestId('live-toggle').dispatchEvent('click');
	await expect(notice).toHaveCount(0);
	expect((await panel.boundingBox())!.y).toBeCloseTo(before, 0);

	expect(pageErrors).toEqual([]);
});

// The panel stays in the window, the addresses scroll, the title sits outside
// them. The seed has too few addresses to overflow, so this pins the structure.
test('the addresses scroll inside a panel that stays in the window', async ({
	page,
	pageErrors,
}) => {
	await page.setViewportSize({width: 1280, height: 320});

	const panel = await openPanel(page);
	await expandAddresses(page);
	await expect(
		panel.locator('[data-testid^="identity-row-"]').first(),
	).toBeVisible();

	const measured = await page.evaluate<{
		bottom: number;
		viewport: number;
		scrollerScrolls: boolean;
		scrollerHoldsRows: boolean;
		scrollerHoldsTitle: boolean;
	}>(`
		(() => {
			const panel = document.querySelector('[data-testid="settings-panel"]');
			const box = panel.getBoundingClientRect();
			const scroller = panel.querySelector('[data-testid="settings-scroller"]');
			const row = panel.querySelector('[data-testid^="identity-row-"]');

			return {
				bottom: Math.round(box.bottom),
				viewport: window.innerHeight,
				scrollerScrolls: getComputedStyle(scroller).overflowY === 'auto',
				scrollerHoldsRows: Boolean(row && scroller.contains(row)),
				scrollerHoldsTitle: scroller.textContent.includes('Settings'),
			};
		})()
	`);

	expect(measured.bottom).toBeLessThanOrEqual(measured.viewport);
	expect(measured.scrollerScrolls).toBe(true);
	expect(measured.scrollerHoldsRows).toBe(true);
	expect(measured.scrollerHoldsTitle).toBe(false);

	expect(pageErrors).toEqual([]);
});

// Config is restored via the filesystem: the worker shares one `config.json`,
// and the field refuses a sub-floor value.
test('auto sync and its interval are editable, and survive a reload', async ({
	page,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		const panel = await openPanel(page);
		await expandSync(page);
		const interval = panel.getByTestId('autosync-interval');
		await expect(interval).toBeVisible();

		await interval.fill('37');
		await interval.press('Enter');

		// Reopening asks again on the same socket, answered after the write.
		await page.keyboard.press('Escape');
		await openPanel(page);
		await expandSync(page);
		await expect(page.getByTestId('autosync-interval')).toHaveValue('37');

		// And now the file, which is the only thing that outlives the page.
		await page.reload();
		await expect(page.getByTestId('board-switcher')).toContainText('Default');
		await openPanel(page);
		await expandSync(page);
		await expect(page.getByTestId('autosync-interval')).toHaveValue('37');

		// The floor is refused in the field, which falls back to the configured value.
		const reopened = page.getByTestId('autosync-interval');
		await reopened.fill('1');
		await expect(page.getByTestId('settings-panel')).toContainText(
			'3 seconds is the shortest interval',
		);
		await reopened.blur();
		await expect(reopened).toHaveValue('37');

		// And the toggle, which is the setting the interval is about.
		const was = await page
			.getByTestId('autosync-toggle')
			.locator('input')
			.isChecked();

		await page.getByTestId('autosync-toggle').click();
		await expect(
			page.getByTestId('autosync-toggle').locator('input'),
		).toBeChecked({checked: !was});

		await page.getByTestId('autosync-toggle').click();
		await expect(
			page.getByTestId('autosync-toggle').locator('input'),
		).toBeChecked({checked: was});

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});

// A stored sub-floor interval is legitimate, so it shows without an error.
test('a configured interval under the floor is shown, not flagged', async ({
	page,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

		await page.reload();
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		const panel = await openPanel(page);
		await expandSync(page);
		await expect(panel.getByTestId('autosync-interval')).toHaveValue('1');
		await expect(panel).not.toContainText('shortest interval');

		// And it stays quiet through a blur, rather than the field rewriting
		// its own value and raising the error again.
		await panel.getByTestId('autosync-interval').click();
		await panel.getByTestId('autosync-interval').blur();
		await expect(panel.getByTestId('autosync-interval')).toHaveValue('1');
		await expect(panel).not.toContainText('shortest interval');

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});

// Measured as a difference: the shared board carries earlier files' tickets.
const ticketsOpened = async (page: Page): Promise<number> => {
	const figure = page.getByTestId('identity-stat-tickets-value');

	await expect(figure).toBeVisible();

	return Number(await figure.textContent());
};

test('the panel counts your own tickets, and the count follows the board', async ({
	page,
	pageErrors,
}) => {
	const panel = await openPanel(page);
	await expect(panel.getByTestId('identity-stats')).toContainText('Commits');
	await expect(panel.getByTestId('identity-stats')).toContainText('Comments');

	// Somebody has been here, so the board knows when they arrived.
	await expect(panel.getByTestId('identity-stat-joined-value')).not.toHaveText(
		'Not yet',
	);

	const before = await ticketsOpened(page);

	await page.keyboard.press('Escape');
	await addTicket(page, `Counted ${Date.now()}`);

	// Re-opening is what asks again: the totals are fetched on opening the
	// panel, not pushed with every board broadcast.
	await openPanel(page);
	await expect.poll(() => ticketsOpened(page)).toBe(before + 1);

	expect(pageErrors).toEqual([]);
});

test('claiming an address makes its commits read as you, and unlinking undoes it', async ({
	page,
	repoRoot,
	pageErrors,
}) => {
	const stamp = Date.now();
	await commitAndReload(page, repoRoot, `${stamp}`);

	// Before: the log calls the commit by the name git signed it with.
	await page.getByTestId('log-toggle').click();
	await expect(page.locator('.epiq-log-actor').first()).toBeVisible();
	await expect(
		page.locator('.epiq-log-actor', {hasText: 'e2e'}),
	).not.toHaveCount(0);

	let panel = await openPanel(page);
	await expandAddresses(page);

	// The address matches nothing the viewer is called, so it sits behind the disclosure.
	const more = panel.getByRole('button', {name: /more address/});
	if (await more.count()) await more.click();

	const row = panel.getByTestId(`identity-row-${COMMIT_EMAIL}`);
	await expect(row).toContainText(COMMIT_EMAIL);
	// Two clicks: a claim is permanent, so the first only arms the button.
	await row.getByRole('button', {name: 'This is me'}).click();
	await row.getByRole('button', {name: 'confirm'}).click();

	// No reload: claiming refetches the commit track itself.
	await expect(
		page.locator('.epiq-log-actor', {hasText: BOARD_NAME.split('/')[1]!}),
	).not.toHaveCount(0);
	await expect(page.locator('.epiq-log-actor', {hasText: 'e2e'})).toHaveCount(
		0,
	);

	// And back: the address stops resolving, which is all unlinking promises.
	panel = page.getByTestId('settings-panel');
	await panel
		.getByTestId(`identity-row-${COMMIT_EMAIL}`)
		.getByRole('button', {name: 'Unclaim'})
		.click();

	await expect(
		page.locator('.epiq-log-actor', {hasText: 'e2e'}),
	).not.toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
