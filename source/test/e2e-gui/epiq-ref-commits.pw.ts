// A commit can name its ticket with an `Epiq-Ref:` line in its body rather
// than a ref leading its subject. Linked that way it is linked everywhere, and
// its body says so.

import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {commitPlainFile} from './linked-commit.js';

test('a commit linked by an Epiq-Ref line is a linked commit, opens its ticket, and shows its body', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Trailer ${stamp}`);
	const subject = `trailer work ${stamp}`;
	commitPlainFile(
		repoRoot,
		`trailer-${stamp}.txt`,
		subject,
		'one\n',
		undefined,
		['Why it was done.', `Epiq-Ref: ${ref}`],
	);

	await page.goto(boardUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByTestId('log-toggle').click();

	const select = page.getByTestId('commit-select');
	await select.click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();
	await expect(select).toHaveText('Commits (linked)');

	const line = page.getByTestId('log-line').filter({hasText: subject});
	await expect(line).toHaveCount(1);

	await line.click();
	await expect(page).toHaveURL(new RegExp(`/issue/${ref}\\?tab=code`));

	const body = page.locator('aside').getByTestId('commit-body');
	await expect(body).toContainText('Why it was done.');
	await expect(body).toContainText(`Epiq-Ref: ${ref}`);

	expect(pageErrors).toEqual([]);
});

test('the commit panel shows a commit’s subject and body', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	const stamp = Date.now();
	const subject = `unlinked work ${stamp}`;
	commitPlainFile(
		repoRoot,
		`unlinked-${stamp}.txt`,
		subject,
		'one\n',
		undefined,
		[`A body for ${stamp}.`],
	);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByTestId('log-toggle').click();
	await page.getByTestId('log-line').filter({hasText: subject}).click();

	await expect(page.getByTestId('commit-subject')).toHaveText(subject);
	await expect(page.getByTestId('commit-body')).toHaveText(
		`A body for ${stamp}.`,
	);

	expect(pageErrors).toEqual([]);
});
