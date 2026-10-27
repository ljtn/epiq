import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {commitPlainFile} from './linked-commit.js';

const lines = (count: number, word: string) =>
	`${Array.from({length: count}, (_, line) => `${word} ${line}`).join('\n')}\n`;

// Long enough that the first, left open, pushes the second out of view.
test('opening a commit from the log folds the others and brings it into view', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Two commits ${Date.now()}`);
	// A minute apart, so oldest-first puts them in a known order.
	const now = Date.now();
	for (const [word, ago] of [
		['first', 60_000],
		['second', 0],
	] as const) {
		commitPlainFile(
			repoRoot,
			`${word}-${ref}.txt`,
			`${word} of ${ref}`,
			lines(150, word),
			new Date(now - ago),
			[`Epiq-Ref: ${ref}`],
		);
	}

	await page.reload();
	await page.getByTestId('log-toggle').click();
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();

	const card = (subject: string) =>
		page.getByTestId('commit-card').filter({hasText: subject});
	const header = (subject: string) =>
		card(subject).locator('[aria-expanded]').first();

	await page
		.getByTestId('log-line')
		.filter({hasText: `first of ${ref}`})
		.click();
	await expect(header(`first of ${ref}`)).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	await expect(header(`second of ${ref}`)).not.toBeInViewport();

	await page
		.getByTestId('log-line')
		.filter({hasText: `second of ${ref}`})
		.click();
	await expect(header(`second of ${ref}`)).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	await expect(header(`first of ${ref}`)).toHaveAttribute(
		'aria-expanded',
		'false',
	);
	await expect(header(`second of ${ref}`)).toBeInViewport();

	expect(pageErrors).toEqual([]);
});
