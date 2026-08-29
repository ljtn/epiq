import {expect, test} from './fixtures.js';

// Outside an epiq project the state request fails and nothing further arrives,
// so the GUI has to say there is nothing to load rather than report waiting.
test('says the folder is not an epiq project instead of loading forever', async ({
	page,
	bareAppUrl,
	bareRepoRoot,
	pageErrors,
}) => {
	await page.goto(bareAppUrl);

	const screen = page.getByTestId('init-project-screen');
	await expect(screen).toBeVisible();

	// The directory that was actually searched, so the reader can tell whether
	// the GUI was pointed where they thought.
	await expect(screen).toContainText(bareRepoRoot);
	// How to get out of it.
	await expect(screen).toContainText(':init');

	await expect(page.getByText('Loading...')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});

test('leaves the board alone in a repo that does have a project', async ({
	page,
	appUrl,
}) => {
	await page.goto(appUrl);

	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('init-project-screen')).toHaveCount(0);
});

// The worker's seeded project was booted by the same process that serves the
// bare directory, so it is the one recent project the bare screen can offer.
test('offers the recently opened project and boots into it', async ({
	page,
	bareAppUrl,
	repoRoot,
	pageErrors,
}) => {
	await page.goto(bareAppUrl);

	const screen = page.getByTestId('init-project-screen');
	await expect(screen).toBeVisible();

	const recent = page.getByTestId('recent-project');
	await expect(recent).toHaveCount(1);
	await expect(recent).toContainText(repoRoot);

	await page.getByTestId('open-recent-project').click();

	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('init-project-screen')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
