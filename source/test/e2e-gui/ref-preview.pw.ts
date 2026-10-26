import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Retries the hover, not the assertion: a broadcast can move the panel from under the pointer.
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
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill(title);
	await page.getByPlaceholder('ticket name').press('Enter');

	// This ticket's own panel: a loose `/issue/` check passes on the previous ticket.
	await expect(page.locator('aside')).toContainText(title);

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

// A ref is washed in its colour under the pointer, before the card opens.
test('a ref lights under the pointer', async ({page, appUrl, pageErrors}) => {
	const stamp = Date.now();

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const targetRef = await createTicket(
		page,
		`Lit target ${stamp}`,
		'Anything at all.',
	);
	await createTicket(page, `Lit source ${stamp}`, `Blocked on ${targetRef}.`);

	const description = page.getByTestId('description-box');
	// The body first: the previous ticket shows briefly after the save.
	await expect(description).toContainText(targetRef);

	const refLink = description.getByRole('button', {
		name: `Open ${targetRef}`,
	});
	await expect(refLink).toBeVisible();

	// A string, like the suite's other DOM reads: these files are type-checked
	// against the Node libs, which have no `getComputedStyle`.
	const background = async () =>
		(await page.evaluate(
			`getComputedStyle(document.querySelector(` +
				`'[data-testid="description-box"] [data-ticket-ref]')).backgroundColor`,
		)) as string;

	const unlit = 'rgba(0, 0, 0, 0)';
	expect(await background()).toBe(unlit);

	// The hover is retried rather than the read: a state broadcast re-lays the
	// panel out and can move it out from under a pointer that is not moving.
	await expect(async () => {
		await refLink.hover();
		expect(await background()).not.toBe(unlit);
	}).toPass({timeout: 15_000});

	// The board changing under a pointer that stays: another client adds a
	// ticket, and the ref stays lit rather than being drawn anew without it.
	const other = await page.context().newPage();
	await other.goto(appUrl);
	await expect(other.getByTestId('board-switcher')).toContainText('Default');
	await createTicket(other, `Lit elsewhere ${stamp}`, 'Meanwhile.');
	await expect(page.getByText(`Lit elsewhere ${stamp}`)).toBeVisible();
	expect(await background()).not.toBe(unlit);
	await other.close();

	await description.hover({position: {x: 5, y: 5}});
	await expect.poll(background).toBe(unlit);

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
