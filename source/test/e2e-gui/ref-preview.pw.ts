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
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');

	// This ticket's own panel, not merely some `/issue/` url. Every test here
	// creates two in a row, so on the second call the first ticket's url already
	// satisfies a loose check — the edit below then opens on the *previous*
	// panel, and the navigation lands a moment later and tears the editor down,
	// leaving `getByRole('textbox')` waiting for a box that no longer exists.
	// That is the whole of this file's place on the CI flaky list.
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

// The card waits out a delay before it opens. Until then the ref itself is all
// there is to say the word can be pressed, so it takes a wash of its own colour
// the moment the pointer is on it.
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
	// The box before what is in it: the panel is still showing the ticket
	// before this one for a moment after the save, and a description box that
	// holds the wrong body reads here as a ref that failed to linkify.
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
