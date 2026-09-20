import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';
import {commitLinkedFile, linkedFileName} from './linked-commit.js';

const tabButtons = (page: Page) =>
	page
		.locator('aside')
		.getByRole('button', {name: /^(Overview|Comments|Code)\b/});

// By its test id, not its title: the click below leaves the pointer on the
// button, TooltipLayer opens over it and takes the `title` away, and whether
// this file passed was a race between that and the next locator. It lost four
// gate runs in a row while passing on its own.
const fullscreenToggle = (page: Page) => page.getByTestId('fullscreen-toggle');

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('a wide fullscreen panel shows every pane side by side', async ({
	page,
	pageErrors,
}, testInfo) => {
	await page.setViewportSize({width: 1600, height: 900});
	await addTicket(page, `Lanes ${Date.now()}`);
	await expect(tabButtons(page)).toHaveCount(3);

	await fullscreenToggle(page).click();

	await expect(tabButtons(page)).toHaveCount(0);
	for (const lane of ['overview', 'comments', 'commits']) {
		await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
	}
	// Each lane holds its pane's actual content, not just a heading.
	await expect(page.getByText('No description')).toBeVisible();
	await expect(page.getByPlaceholder(/comment/i)).toBeVisible();
	await expect(
		page.getByText(/no commits reference this ticket/i),
	).toBeVisible();

	// The commits lane is the wide one: at least twice any other.
	const widthOf = async (lane: string) =>
		(await page.getByTestId(`lane-${lane}`).boundingBox())?.width ?? 0;
	const commits = await widthOf('commits');
	for (const lane of ['overview', 'comments']) {
		expect(commits).toBeGreaterThanOrEqual((await widthOf(lane)) * 2);
	}

	// Nothing runs off the right edge of the window.
	for (const target of [
		page.getByTestId('lane-commits'),
		fullscreenToggle(page),
	]) {
		const box = await target.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x + box!.width).toBeLessThanOrEqual(1600);
	}

	await page.screenshot({
		path: testInfo.outputPath('lanes.png'),
		fullPage: false,
	});

	// Leaving fullscreen brings the tabs back.
	await fullscreenToggle(page).click();
	await expect(tabButtons(page)).toHaveCount(3);
	await expect(page.getByPlaceholder(/comment/i)).toBeHidden();

	expect(pageErrors).toEqual([]);
});

test('a narrow fullscreen panel keeps the tabs', async ({page, pageErrors}) => {
	await page.setViewportSize({width: 1200, height: 800});
	await addTicket(page, `Tabbed ${Date.now()}`);

	await fullscreenToggle(page).click();

	await expect(tabButtons(page)).toHaveCount(3);
	await expect(page.getByTestId('lane-overview')).toHaveCount(0);
	await expect(page.getByPlaceholder(/comment/i)).toBeHidden();

	// Widening the window while fullscreen flips it to lanes.
	await page.setViewportSize({width: 1600, height: 800});
	await expect(tabButtons(page)).toHaveCount(0);
	await expect(page.getByTestId('lane-commits')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// `ES6E62N` opened every commit and file here, "since it is for reading rather
// than scanning" — which was true while this was the only place the whole
// change could be read. `EEXWZN5` then gave the Code tab a compacted view that
// shows it in one piece, and took that job. So the lanes list the commits like
// the tabs do, and the reading happens next door (3RQ4QG4).
test('the lanes list the commits to scan, as the tabs do', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	await page.setViewportSize({width: 1600, height: 900});
	await addTicket(page, `Open diffs ${Date.now()}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// Two commits: a lone one opens on its own in either layout, and the point
	// here is what the lanes do that the tabs do not.
	const fileName = linkedFileName(ref!);
	const otherFile = `other-${ref}.txt`;
	commitLinkedFile(repoRoot, ref!, 'add notes');
	commitLinkedFile(repoRoot, ref!, 'add more', otherFile);
	await page.reload();
	await expect(
		page.getByTestId('aside-pane').getByRole('button', {name: /^Code \(2\)/}),
	).toBeVisible();

	// Tabbed: collapsed, as before.
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();

	// A budget each, because these are two arrivals: the row comes with the
	// commit, its diff stat only once git has been asked for one. Sharing a
	// single 10s timeout between them is what made this flake on a busy
	// machine — and said "element not found" for whichever half was late.
	const commitRow = page.getByRole('button', {name: /^add notes/});
	await expect(commitRow).toBeVisible();
	await expect(commitRow).toHaveAccessibleName('add notes +3 -0');
	await expect(commitRow).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('[data-line]')).toHaveCount(0);

	// Lanes: the same list, and no diff drawn until one is asked for.
	await fullscreenToggle(page).click();
	await expect(page.getByTestId('lane-commits')).toBeVisible();
	await expect(commitRow).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('[data-line]')).toHaveCount(0);

	// And opening one by hand still opens its files with it.
	await commitRow.click();
	await expect(commitRow).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('[data-line]')).toHaveCount(3);
	await expect(page.locator('[data-line]').first()).toHaveText('alpha');

	// Collapsing the file by hand sticks.
	await page.getByRole('button', {name: fileName}).click();
	await expect(page.locator('[data-line]')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
