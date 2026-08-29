import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

// The seeded repo has no code history: link one commit to the ticket by
// prefixing its subject with the ref shown in the panel.
const commitFor = (repoRoot: string, ref: string, subject: string) => {
	fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'alpha\nbeta\ngamma\n');
	const git = (...args: string[]) =>
		execFileSync(
			'git',
			['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args],
			{cwd: repoRoot, stdio: 'pipe'},
		);
	git('add', 'notes.txt');
	git('commit', '-q', '-m', `${ref} ${subject}`);
};

const openDiffAndSelectLine = async (page: Page, subject: string) => {
	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: subject}).click();
	await page.getByRole('button', {name: 'notes.txt'}).click();
	// A click on the number column is a one-line selection.
	await page.locator('[data-column-number]').first().click();
	await expect(page.getByTestId('selection-composer')).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('selecting lines opens one composer under them; write, then comment or file a ticket', async ({
	page,
	pageErrors,
	repoRoot,
}, testInfo) => {
	const stamp = Date.now();
	await addTicket(page, `Composer ${stamp}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitFor(repoRoot, ref!, 'add notes');
	// The server caches the full commit timeline for 5s; outlive it so the
	// reload sees the new commit.
	await page.waitForTimeout(5_500);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Composer ${stamp}`);

	await openDiffAndSelectLine(page, 'add notes');
	const composer = page.getByTestId('selection-composer');
	await expect(composer).toContainText('notes.txt line 1');
	// Sits inside the diff between the selected line and the next one — not
	// below the file.
	const box = async (locator: ReturnType<Page['locator']>) => {
		const rect = await locator.boundingBox();
		expect(rect).not.toBeNull();
		return rect!;
	};
	const lines = page.locator('[data-line]');
	const lineOne = await box(lines.nth(0));
	const lineTwo = await box(lines.nth(1));
	const composerBox = await box(composer);
	expect(composerBox.y).toBeGreaterThanOrEqual(lineOne.y + lineOne.height - 2);
	expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(lineTwo.y + 2);
	// No action chosen up front: the note comes first.
	await expect(composer.getByRole('button', {name: 'Cancel'})).toBeVisible();
	await expect(
		composer.getByRole('button', {name: 'File ticket'}),
	).toBeVisible();
	await expect(composer.getByRole('button', {name: 'Comment'})).toBeVisible();

	await page.screenshot({path: testInfo.outputPath('composer.png')});

	// Escape drops it.
	await composer.getByPlaceholder(/add a note/i).press('Escape');
	await expect(composer).toBeHidden();

	// Comment.
	await page.locator('[data-column-number]').first().click();
	await composer.getByPlaceholder(/add a note/i).fill('looks off');
	await composer.getByRole('button', {name: 'Comment'}).click();
	await expect(composer).toBeHidden();
	// Rendered under the line as an annotation.
	const posted = page.getByText('looks off');
	await expect(posted).toBeVisible();
	const postedBox = await box(posted);
	const lineOneAfter = await box(lines.nth(0));
	expect(postedBox.y).toBeGreaterThanOrEqual(
		lineOneAfter.y + lineOneAfter.height - 2,
	);
	await expect(page.getByRole('button', {name: 'Comments (1)'})).toBeVisible();

	// File a ticket: first line is the title, the rest the note.
	await page.locator('[data-column-number]').first().click();
	await composer
		.getByPlaceholder(/add a note/i)
		.fill(`Follow-up ${stamp}\nneeds a second look`);
	await composer.getByRole('button', {name: 'File ticket'}).click();
	await expect(composer).toBeHidden();
	await expect(
		page.locator('[draggable="true"]').filter({hasText: `Follow-up ${stamp}`}),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
});
