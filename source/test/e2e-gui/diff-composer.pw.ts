import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFile} from './linked-commit.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

// Opens the commit and its file if they aren't open already — once a diff
// link has been followed the URL keeps pointing at the spot, and the tab then
// opens both on its own.
const expandDiff = async (page: Page, subject: string) => {
	await page.getByRole('button', {name: /^Commits/}).click();
	for (const name of [subject, 'notes.txt']) {
		const toggle = page.getByRole('button', {name});
		await expect(toggle).toBeVisible();
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
			await toggle.click();
		}
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	}
};

const openDiffAndSelectLine = async (page: Page, subject: string) => {
	await expandDiff(page, subject);
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

	commitLinkedFile(repoRoot, ref!, 'add notes');
	await page.waitForTimeout(COMMIT_CACHE_MS);
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

	// Comment on line 2.
	await page.locator('[data-column-number]').nth(1).click();
	await expect(composer).toContainText('notes.txt line 2');
	await composer.getByPlaceholder(/add a note/i).fill('looks off');
	await composer.getByRole('button', {name: 'Comment'}).click();
	await expect(composer).toBeHidden();
	// Rendered under the line as an annotation.
	const posted = page.getByText('looks off');
	await expect(posted).toBeVisible();
	const postedBox = await box(posted);
	const lineTwoAfter = await box(lines.nth(1));
	expect(postedBox.y).toBeGreaterThanOrEqual(
		lineTwoAfter.y + lineTwoAfter.height - 2,
	);
	await expect(page.getByRole('button', {name: 'Comments (1)'})).toBeVisible();

	// Hovering the comment lights up the line it is about.
	await expect(page.locator('[data-line][data-selected-line]')).toHaveCount(0);
	await page.getByTestId('diff-comment').hover();
	await expect(page.locator('[data-line][data-selected-line]')).toHaveText([
		'beta',
	]);
	await page.mouse.move(0, 0);
	await expect(page.locator('[data-line][data-selected-line]')).toHaveCount(0);

	// The Comments tab quotes the snippet with its real line number.
	await page.getByRole('button', {name: 'Comments (1)'}).click();
	await expect(page.getByTestId('snippet-gutter')).toHaveText('2');
	await expect(page.getByTestId('code-snippet')).toContainText('beta');
	await page.screenshot({path: testInfo.outputPath('comment-snippet.png')});

	// The snippet paints the app's background, not the highlighter theme's,
	// which is a near match for the card around it.
	const snippetBackground = await page.evaluate<string>(`
		(() => {
			const snippet = document.querySelector('[data-testid="code-snippet"]');
			const host = [...snippet.querySelectorAll('*')].find(el => el.shadowRoot);
			return getComputedStyle(host).backgroundColor;
		})()
	`);
	expect(snippetBackground).toBe('rgb(6, 7, 10)');

	// Editing a diff comment edits its note; the link and snippet stay.
	await page.getByTitle('Edit comment').click();
	const editor = page.locator('aside textarea').first();
	await expect(editor).toHaveValue('looks off');
	await editor.fill('looks fine after all');
	await page.getByRole('button', {name: 'save'}).click();
	await expect(
		page.locator('aside').getByText('looks fine after all'),
	).toBeVisible();
	await expect(
		page.locator('aside').getByTitle('Open this in the diff'),
	).toHaveText('notes.txt line 2 (added)');
	await expect(page.getByTestId('code-snippet')).toContainText('beta');

	// ...and the annotation in the diff follows the edit.
	await expandDiff(page, 'add notes');
	await expect(page.getByTestId('diff-comment')).toContainText(
		'looks fine after all',
	);

	// Deleting it takes the annotation away too.
	await page.getByRole('button', {name: 'Comments (1)'}).click();
	await page.getByTitle('Delete comment').click();
	await expect(page.getByRole('button', {name: 'Comments (0)'})).toBeVisible();
	await expandDiff(page, 'add notes');
	await expect(page.getByTestId('diff-comment')).toHaveCount(0);
	await expect(page.locator('[data-line]')).toHaveCount(3);

	// File a ticket: the note stays the note, the title is asked for.
	await expandDiff(page, 'add notes');
	await page.locator('[data-column-number]').first().click();
	await composer.getByPlaceholder(/add a note/i).fill('needs a second look');
	await composer.getByRole('button', {name: 'File ticket'}).click();
	const titleInput = page.getByPlaceholder('Ticket title');
	await expect(titleInput).toBeVisible();
	// Prefilled with the note, still editable.
	await expect(titleInput).toHaveValue('needs a second look');
	await page.screenshot({path: testInfo.outputPath('title-prompt.png')});
	// Empty title: nothing filed, prompt stays.
	await titleInput.fill('');
	await titleInput.press('Enter');
	await expect(titleInput).toBeVisible();
	await titleInput.fill(`Follow-up ${stamp}`);
	await titleInput.press('Enter');
	await expect(titleInput).toBeHidden();
	await expect(composer).toBeHidden();
	const filed = page
		.locator('[draggable="true"]')
		.filter({hasText: `Follow-up ${stamp}`});
	await expect(filed).toBeVisible();

	// The filed ticket's description is the note plus the snippet, headed by
	// a link back to the origin ticket's diff at the selection.
	await filed.click();
	await expect(page.locator('aside')).toContainText(`Follow-up ${stamp}`);
	await expect(page.locator('aside')).toContainText('needs a second look');
	const snippetHeader = page
		.locator('aside')
		.getByTitle('Open this in the diff');
	await expect(snippetHeader).toHaveText(`${ref} · notes.txt line 1 (added)`);
	await expect(page.locator('aside').getByText('alpha')).toBeVisible();
	await page.screenshot({path: testInfo.outputPath('filed-ticket.png')});

	// The header collapses the snippet and offers the commit's sha.
	await expect(
		page.locator('aside').getByTitle(/^Copy [0-9a-f]{40}$/),
	).toBeVisible();
	await page.locator('aside').getByTitle('Hide snippet').click();
	await expect(page.locator('aside').getByText('alpha')).toBeHidden();
	await page.locator('aside').getByTitle('Show snippet').click();
	await expect(page.locator('aside').getByText('alpha')).toBeVisible();

	await snippetHeader.click();
	await expect(page).toHaveURL(new RegExp(`/issue/${ref}\\?.*tab=code`));
	await expect(page).toHaveURL(/commit=[0-9a-f]{40}/);
	await expect(page.locator('aside')).toContainText(`Composer ${stamp}`);
	await expect(page.locator('[data-selected-line]').first()).toBeVisible();

	expect(pageErrors).toEqual([]);
});
