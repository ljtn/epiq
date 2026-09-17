import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The hover is retried, not the assertion. A state broadcast re-lays the
// panel out, and the panel can move out from under a pointer that is not
// itself moving — which is a hover that ended, not a preview that failed to
// open. Hovering again is what a reader does without noticing.
const hoverUntilPreviewed = async (page: Page, trigger: Locator) => {
	await expect(async () => {
		await trigger.hover();
		await expect(page.getByTestId('ticket-preview')).toBeVisible({
			timeout: 2_000,
		});
	}).toPass({timeout: 15_000});
};

// Returns the new ticket's ref, which is what the URL is keyed by.
const createTicket = async (
	page: Page,
	title: string,
	description: string,
): Promise<string> => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);

	await page.getByRole('button', {name: 'edit'}).first().click();
	const box = page.getByRole('textbox').last();
	await box.fill(description);
	await box.press('ControlOrMeta+Enter');
	await expect(page.getByTestId('description-box')).toBeVisible();

	return new URL(page.url()).pathname.split('/issue/')[1]!;
};

test('hovering a ticket ref previews the ticket it names', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const stamp = Date.now();
	const targetTitle = `Preview target ${stamp}`;

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const targetRef = await createTicket(
		page,
		targetTitle,
		'## Heading\n\nThe sentence a preview should show.\n\n```ts\nconst hidden = 1;\n```',
	);

	await createTicket(
		page,
		`Preview source ${stamp}`,
		`Blocked on ${targetRef}.`,
	);

	// Scoped to the description rather than the page: a bare ref-shaped string
	// matches in the log and the board behind the panel too.
	const refLink = page
		.getByTestId('description-box')
		.getByRole('button', {name: `Open ${targetRef}`});
	await expect(refLink).toBeVisible();

	await hoverUntilPreviewed(page, refLink);

	const preview = page.getByTestId('ticket-preview');
	await expect(preview).toContainText(targetTitle);
	await expect(preview).toContainText(targetRef);
	// The excerpt: prose kept, heading marks and the fenced block dropped.
	await expect(preview).toContainText('The sentence a preview should show.');
	await expect(preview).toContainText('Heading');
	await expect(preview).not.toContainText('const hidden');

	// The ref's own hint, and only it — an enclosing `title` opening a plain
	// tooltip beside the card would be two boxes about one word.
	await expect(page.getByTestId('tooltip')).toBeHidden();

	expect(pageErrors).toEqual([]);
});

test('the preview goes away when the pointer leaves the ref', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const stamp = Date.now();

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const targetRef = await createTicket(
		page,
		`Dismiss target ${stamp}`,
		'Anything at all.',
	);
	await createTicket(
		page,
		`Dismiss source ${stamp}`,
		`See ${targetRef} first.`,
	);

	const description = page.getByTestId('description-box');
	await hoverUntilPreviewed(
		page,
		description.getByRole('button', {name: `Open ${targetRef}`}),
	);

	await description.hover({position: {x: 5, y: 5}});
	await expect(page.getByTestId('ticket-preview')).toBeHidden();

	expect(pageErrors).toEqual([]);
});
