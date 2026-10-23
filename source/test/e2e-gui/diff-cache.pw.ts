import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {commitLinkedFiles, commitPlainFile} from './linked-commit.js';

const lines = (count: number, word: string) =>
	`${Array.from({length: count}, (_, line) => `${word} ${line}`).join('\n')}\n`;

// Diff lines carrying `word` that have been drawn highlighted. The diff draws
// inside shadow roots, so they are searched there. A source string, not a
// closure: the root tsconfig has no DOM lib.
const highlightedLinesWith = (page: Page, word: string) =>
	page.evaluate<number>(`(() => {
		let count = 0;
		const walk = root => {
			for (const element of root.querySelectorAll('*')) {
				if (element.shadowRoot) {
					for (const line of element.shadowRoot.querySelectorAll('[data-line]')) {
						if (line.textContent.includes(${JSON.stringify(word)}) &&
							line.querySelector('span[style*="color"]')) count += 1;
					}
					walk(element.shadowRoot);
				}
			}
		};
		walk(document);
		return count;
	})()`);

// One path, modified by two commits by different amounts, drawn one after the
// other in one page. Each is highlighted from its own contents: drawn from the
// first's highlighted lines, the second runs out of them and the renderer
// throws in place of the diff.
test('a path modified by two commits draws each commit’s own diff', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Two diffs ${Date.now()}`);
	const fileName = `twice-${ref}.ts`;
	// Both linked commits modify it, as a ticket's commits usually do: an added
	// file is keyed apart from a modified one even by name alone.
	commitPlainFile(repoRoot, fileName, 'base', lines(2, 'base'));
	const first = commitLinkedFiles(repoRoot, ref, 'first pass', {
		[fileName]: lines(3, 'first'),
	});
	const second = commitLinkedFiles(repoRoot, ref, 'second pass', {
		[fileName]: lines(40, 'second'),
	});

	await page.reload();
	await page.getByTestId('log-toggle').click();
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();

	for (const [subject, sha, word] of [
		['first pass', first, 'first'],
		['second pass', second, 'second'],
	]) {
		await page.getByTestId('log-line').filter({hasText: subject}).click();
		await expect(page).toHaveURL(new RegExp(`[?&]commit=${sha}`));
		await expect
			.poll(() => highlightedLinesWith(page, word!))
			.toBeGreaterThan(0);
	}

	await expect(page.getByText('something is wrong')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
