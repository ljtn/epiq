import {expect, test} from './fixtures.js';

// Regression for 5X9MA0H: outside an epiq project the state request fails and
// nothing further arrives, so the board sat on "Loading..." forever. The GUI
// has to say there is nothing to load here rather than report waiting.
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
