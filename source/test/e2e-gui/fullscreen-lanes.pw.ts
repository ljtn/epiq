import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const tabButtons = (page: Page) =>
	page
		.locator('aside')
		.getByRole('button', {name: /^(Overview|Comments|Commits|Log)\b/});

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
	await expect(tabButtons(page)).toHaveCount(4);

	await page.getByTitle('Fullscreen').click();

	await expect(tabButtons(page)).toHaveCount(0);
	for (const lane of ['overview', 'comments', 'commits', 'log']) {
		await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
	}
	// Each lane holds its pane's actual content, not just a heading.
	await expect(page.getByText('No description')).toBeVisible();
	await expect(page.getByPlaceholder(/comment/i)).toBeVisible();
	await expect(
		page.getByText(/no commits reference this ticket/i),
	).toBeVisible();
	await expect(page.getByTestId('issue-history')).toBeVisible();

	// The commits lane is the wide one: at least twice any other.
	const widthOf = async (lane: string) =>
		(await page.getByTestId(`lane-${lane}`).boundingBox())?.width ?? 0;
	const commits = await widthOf('commits');
	for (const lane of ['overview', 'comments', 'log']) {
		expect(commits).toBeGreaterThanOrEqual((await widthOf(lane)) * 2);
	}

	// Nothing runs off the right edge of the window.
	for (const target of [
		page.getByTestId('lane-log'),
		page.getByTitle('Exit fullscreen'),
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
	await page.getByTitle('Exit fullscreen').click();
	await expect(tabButtons(page)).toHaveCount(4);
	await expect(page.getByPlaceholder(/comment/i)).toBeHidden();

	expect(pageErrors).toEqual([]);
});

test('a narrow fullscreen panel keeps the tabs', async ({page, pageErrors}) => {
	await page.setViewportSize({width: 1200, height: 800});
	await addTicket(page, `Tabbed ${Date.now()}`);

	await page.getByTitle('Fullscreen').click();

	await expect(tabButtons(page)).toHaveCount(4);
	await expect(page.getByTestId('lane-overview')).toHaveCount(0);
	await expect(page.getByPlaceholder(/comment/i)).toBeHidden();

	// Widening the window while fullscreen flips it to lanes.
	await page.setViewportSize({width: 1600, height: 800});
	await expect(tabButtons(page)).toHaveCount(0);
	await expect(page.getByTestId('lane-commits')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
