import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const openNewTicket = async (page: Page, appUrl: string, name: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `${name} ${Date.now()}`;
	await addTicket(page, title);

	return title;
};

const aside = (page: Page) => page.locator('aside');

test('each empty state opens what its section control opens', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl, 'Empty states');

	await aside(page).getByTestId('description-empty').click();
	await expect(aside(page).getByTestId('description-input')).toBeFocused();
	await aside(page).getByTestId('description-input').press('Escape');

	await aside(page).getByTestId('tags-empty').click();
	await expect(aside(page).getByPlaceholder('Tag name')).toBeFocused();
	// The + it stands in for is gone while the row is open, and so is it.
	await expect(aside(page).getByTestId('tags-empty')).toHaveJSProperty(
		'tagName',
		'SPAN',
	);

	await aside(page).getByTestId('assignees-empty').click();
	await expect(
		aside(page).getByPlaceholder('Name of unknown contributor'),
	).toBeVisible();

	const chooser = page.waitForEvent('filechooser');
	await aside(page).getByTestId('attachments-empty').click();
	await chooser;

	expect(pageErrors).toEqual([]);
});

// Easy to hit, and lit like a menu row under the pointer.
test('an empty state is a tall target lifted under the pointer', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl, 'Empty target');
	const empty = aside(page).getByTestId('tags-empty');

	const box = await empty.boundingBox();
	expect(box?.height).toBeGreaterThanOrEqual(26);
	await expect(empty).toHaveCSS('color', 'rgb(106, 112, 144)');

	await expect(empty).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	await empty.hover();
	await expect(empty).toHaveCSS('background-color', 'rgba(120, 146, 204, 0.1)');
	await expect(empty).toHaveCSS('color', 'rgb(106, 112, 144)');

	expect(pageErrors).toEqual([]);
});

test('an empty state is reached by Tab and activated by Enter', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl, 'Empty keys');

	await aside(page).getByTestId('description-edit').focus();
	await page.keyboard.press('Tab');
	await expect(aside(page).getByTestId('description-empty')).toBeFocused();

	await page.keyboard.press('Enter');
	await expect(aside(page).getByTestId('description-input')).toBeFocused();

	expect(pageErrors).toEqual([]);
});

// Offline wears the readonly a scrub does, so this covers time travel too.
test('a readonly ticket keeps its empty states as plain text', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	let refuse = false;
	let cut: (() => void) | null = null;

	await page.routeWebSocket(/\/ws/, ws => {
		if (refuse) {
			ws.close();
			return;
		}

		const server = ws.connectToServer();
		ws.onMessage(message => server.send(message));
		server.onMessage(message => ws.send(message));
		cut = () => ws.close();
	});

	await openNewTicket(page, appUrl, 'Empty readonly');
	await expect(aside(page).getByTestId('description-empty')).toHaveJSProperty(
		'tagName',
		'BUTTON',
	);

	refuse = true;
	cut!();
	await expect(page.getByTestId('reconnecting')).toBeVisible();

	for (const testId of [
		'description-empty',
		'tags-empty',
		'assignees-empty',
		'attachments-empty',
	]) {
		await expect(aside(page).getByTestId(testId)).toHaveJSProperty(
			'tagName',
			'SPAN',
		);
	}

	await aside(page).getByTestId('description-empty').click();
	await expect(aside(page).getByTestId('description-input')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('a bulk selection with no tags or assignees focuses their inputs', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const titles = [`Empty bulk one ${stamp}`, `Empty bulk two ${stamp}`];
	for (const title of titles) {
		await addTicket(page, title);
		await page.goto(boardUrl);
	}

	for (const title of titles) {
		await page
			.locator('div[draggable="true"]')
			.filter({hasText: title})
			.click({modifiers: ['ControlOrMeta']});
	}
	await expect(aside(page)).toContainText('2 tickets selected');

	await aside(page).getByTestId('bulk-tags-empty').click();
	await expect(aside(page).getByPlaceholder('New tag')).toBeFocused();

	await aside(page).getByTestId('bulk-assignees-empty').click();
	await expect(
		aside(page).getByPlaceholder('Name of unknown contributor'),
	).toBeFocused();

	expect(pageErrors).toEqual([]);
});
