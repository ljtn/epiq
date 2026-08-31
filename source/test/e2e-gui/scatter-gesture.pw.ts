import {execFileSync} from 'node:child_process';
import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFile} from './linked-commit.js';

// A dot is painted on a canvas, so there is no node to aim at and no
// bounding box to read. Its x is pinned instead by handing the scrubber a
// window centred on the commit — the dot then sits at the middle of the track
// by construction — and its y, which is the commit's time of day, is found by
// sweeping the canvas's own height until the hint opens. The hint is matched on
// this commit's own subject, so a sibling test's dot cannot answer for it.
const findCommitDot = async (page: Page, canvas: Locator, hint: Locator) => {
	const box = await canvas.boundingBox();
	if (!box) throw new Error('scatter canvas is not on screen');

	const x = box.x + box.width / 2;

	for (let offset = 2; offset < box.height; offset += 3) {
		await page.mouse.move(x, box.y + offset);
		if (await hint.isVisible()) return {x, y: box.y + offset};
	}

	throw new Error('no commit dot found down the middle of the scatter');
};

// Board, ticket, and one commit, with the scrubber left showing the scatter
// over a two-minute window centred on that commit. `link: false` gives the
// commit a subject that starts with no ref, which is what sends a click to the
// bare diff panel instead of the ticket.
const seedCommitOnScatter = async (
	page: Page,
	appUrl: string,
	repoRoot: string,
	{link = true}: {link?: boolean} = {},
) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Scatter ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Scatter ${stamp}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// The worker's repo is shared by every test in this file, so the file and
	// the subject both carry the stamp: a repeated path has nothing to commit,
	// and a repeated subject would let one test's dot answer for another's.
	const subject = `notes ${stamp}`;
	const sha = commitLinkedFile(
		repoRoot,
		// `chore:` carries a colon, so it can never be read as a ref.
		link ? ref! : 'chore:',
		subject,
		`notes-${stamp}.txt`,
		`line for ${stamp}\n`,
	);
	const committedAt =
		Number(
			execFileSync('git', ['show', '-s', '--format=%ct', sha], {
				cwd: repoRoot,
			})
				.toString()
				.trim(),
		) * 1000;

	// The server caches the commit timeline, so the page has to outlive that
	// before a reload can see the commit at all.
	await page.waitForTimeout(COMMIT_CACHE_MS);

	const url = new URL(page.url());
	url.searchParams.set('layout', 'real');
	url.searchParams.set('from', String(committedAt - 60_000));
	url.searchParams.set('to', String(committedAt + 60_000));
	await page.goto(url.toString());

	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toHaveAttribute('data-entrance', 'done');

	const hint = page.getByText(subject, {exact: false}).last();
	const dot = await findCommitDot(page, canvas, hint);

	return {
		dot,
		sha,
		title: `Scatter ${stamp}`,
		window: {from: url.searchParams.get('from')!},
	};
};

const windowOf = (page: Page) => new URL(page.url()).searchParams.get('from');
const commitOf = (page: Page) => new URL(page.url()).searchParams.get('commit');

// The press used to be stopped over a commit so it could not scrub, which also
// kept it from ever reaching the track — so a drag begun on a dot did nothing
// at all. On a busy scatter that is most of the canvas.
test('a drag that begins on a commit dot still zooms', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const {dot, window} = await seedCommitOnScatter(page, appUrl, repoRoot);

	await page.mouse.move(dot.x, dot.y);
	await page.mouse.down();
	await page.mouse.move(dot.x + 220, dot.y, {steps: 10});
	await page.mouse.up();

	await expect.poll(async () => windowOf(page)).not.toBe(window.from);
	expect(commitOf(page)).toBeNull();

	expect(pageErrors).toEqual([]);
});

// Not a fault that was ever reachable: the track takes pointer capture, and
// that retargets the compatibility mouse events with it, so a click never
// reaches the canvas to be hit-tested at the release. This holds the pair of
// facts the design now rests on — capture on the track, no onClick on the
// canvas — since dropping either would open a commit nobody aimed at.
test('a drag that ends on a commit dot does not open its diff', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const {dot, window} = await seedCommitOnScatter(page, appUrl, repoRoot);

	await page.mouse.move(dot.x - 220, dot.y);
	await page.mouse.down();
	await page.mouse.move(dot.x, dot.y, {steps: 10});
	await page.mouse.up();

	await expect.poll(async () => windowOf(page)).not.toBe(window.from);
	expect(commitOf(page)).toBeNull();

	expect(pageErrors).toEqual([]);
});

// The other half of telling the two apart: a press that goes nowhere is still
// aimed at the dot under it, and still opens the commit rather than scrubbing.
test('a click on a commit dot opens its diff', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const {dot, sha} = await seedCommitOnScatter(page, appUrl, repoRoot);

	await page.mouse.click(dot.x, dot.y);

	await expect.poll(async () => commitOf(page)).toBe(sha);
	expect(new URL(page.url()).searchParams.get('tab')).toBe('code');

	expect(pageErrors).toEqual([]);
});

// The ticket panel renders only while no commit diff does, and nothing used to
// take the diff back down: a dot with no ref opened the bare panel, and every
// ticket opened afterwards stayed hidden behind that same stale diff.
test('a ticket opened after an unlinked commit replaces its diff', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const {dot, sha, title} = await seedCommitOnScatter(page, appUrl, repoRoot, {
		link: false,
	});

	await page.mouse.click(dot.x, dot.y);

	// The sha on the copy button is what only the diff panel carries — the
	// ticket's own "Commits" tab would answer to anything looser.
	const diffPanel = page.locator(`aside button[title="Copy ${sha}"]`);
	await expect(diffPanel).toBeVisible();
	// No ref to follow, so this is the bare panel rather than a ticket route.
	expect(commitOf(page)).toBeNull();

	await page.getByText(title, {exact: false}).first().click();

	await expect(page.locator('aside')).toContainText(title);
	await expect(diffPanel).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
