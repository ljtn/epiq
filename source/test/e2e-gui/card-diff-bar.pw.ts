// The diff stat beside a card's ref: what the ticket's commits added and took
// away, and the hairline that splits the two. A ticket no commit names draws
// nothing at all.

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {
	commitLinkedFile,
	commitLinkedNothing,
	linkedFileName,
} from './linked-commit.js';
import {returnToLive} from './live-board.js';

// Scoped to one ticket's own card — every worker's tests share one repo and one
// board, so other tickets on it may well have commits of their own. The row
// holding the ref is the stat's own parent; the panel's copy of the ref sits in
// a row that has no stat in it, matched or not.
const statOn = (page: Page, ref: string) =>
	page
		.locator(`div:has(> button[title="Copy ${ref}"])`)
		.getByTestId('ticket-diff');

test('a card whose ticket has commits carries its diff stat, and carries none before', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Coded ${Date.now()}`);
	const stat = statOn(page, ref);

	await expect(page.getByTestId('copy-ref').last()).toBeVisible();
	await expect(stat).toHaveCount(0);

	// Three lines added and none removed — `commitLinkedFile`'s own contents.
	commitLinkedFile(repoRoot, ref, 'add notes');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(stat).toHaveCount(1);
	await expect(stat).toHaveText('+3-0');
	// The one thing the figures beside it do not say.
	await expect(stat).toHaveAttribute('title', '1 commit');

	// And it is the way into what it counts, the way the comment count beside
	// it is the way into the comments: the panel opens on the Code tab, in
	// whichever of its views the reader last chose.
	await stat.click();
	await expect(page).toHaveURL(/tab=code/);
	await page.getByTestId('diff-view-commits').click();
	await expect(page).toHaveURL(/diff=commits/);

	await page.getByRole('button', {name: 'Close', exact: true}).click();
	await stat.click();
	await expect(page).toHaveURL(/tab=code/);
	await expect(page).toHaveURL(/diff=commits/);
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	await page.getByTestId('diff-view-flat').click();
	await page.getByRole('button', {name: 'Close', exact: true}).click();
	await stat.click();
	await expect(page).toHaveURL(/diff=flat/);
	await expect(page.getByTestId('commit-card')).toHaveCount(0);
	await expect(page.getByTestId('file-row')).toContainText(linkedFileName(ref));

	expect(pageErrors).toEqual([]);
});

test('the stat on another card moves the selection to it, not beside it', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const first = `First ${Date.now()}`;
	await addTicketForRef(page, first);
	const ref = await addTicketForRef(page, `Second ${Date.now()}`);
	commitLinkedFile(repoRoot, ref, 'add notes');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const card = page.locator('div[draggable="true"]').filter({hasText: first});
	await card.getByTestId('ticket-title').click();
	await expect(card).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');

	await statOn(page, ref).click();
	await expect(page).toHaveURL(/tab=code/);
	await expect(card).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
	await expect(page.locator('aside')).not.toContainText('tickets selected');

	expect(pageErrors).toEqual([]);
});

// The stat is the whole control, so where it draws nothing there must be
// nothing — not a button of its size with no mark in it, which is a thing to
// hover and click that cannot be seen.
test('a ticket whose commits changed no lines carries no stat to click', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Empty ${Date.now()}`);

	commitLinkedNothing(repoRoot, ref, 'nothing to see');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The commit is matched — the Code tab counts it — and still nothing is
	// drawn beside the ref.
	await expect(page.getByTestId('copy-ref').last()).toBeVisible();
	await expect(statOn(page, ref)).toHaveCount(0);
	await expect(
		page.getByTestId('aside-pane').getByRole('button', {name: /^Code \(1\)/}),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The type of every frame the page sends, for what a needle step asks for.
const sentType = (frame: string): string | undefined =>
	(JSON.parse(frame) as {type?: string}).type;

// A board left in the past keeps every later test in the worker there, so it
// goes back however a test ends.
test.afterEach(async ({page}) => {
	await returnToLive(page);
});

// A board parked in the past shows a ticket's code as it stood then: the card
// and the Code tab count the commits made by the needle, and no later one.
test('a scrubbed card and its Code tab count only the commits made by the needle', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	// The needle is parked by a frame of the test's own, at an exact moment a
	// click on the track could not hit.
	let server: {send: (message: string) => void} | null = null;
	const sent: string[] = [];
	await page.routeWebSocket(/\/ws/, ws => {
		const connection = ws.connectToServer();
		server = connection;
		ws.onMessage(message => {
			if (typeof message === 'string') sent.push(sentType(message) ?? '');
			connection.send(message);
		});
		connection.onMessage(message => ws.send(message));
	});
	const scrubTo = async (targetTime: number) => {
		server!.send(
			JSON.stringify({type: 'time-travel:scrub', payload: {targetTime}}),
		);
		await expect(page.getByText('Read-only', {exact: true})).toBeVisible();
	};

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicketForRef(page, `Then ${Date.now()}`);
	commitLinkedFile(repoRoot, ref, 'the early half');
	const needle = Date.now() + 1_000;
	const stepped = needle + 500;
	// Made a whole second past the later needle, as a commit's time is whole
	// seconds. Waited for rather than dated ahead: a commit from the future
	// would lead the shared repo's history for every test after this one.
	await page.waitForTimeout(stepped + 1_000 - Date.now());
	commitLinkedFile(
		repoRoot,
		ref,
		'the late half',
		`later-${ref}.txt`,
		'one\ntwo\n',
	);

	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const stat = statOn(page, ref);
	await expect(stat).toHaveText('+5-0');

	const codeTab = (count: number) =>
		page
			.getByTestId('aside-pane')
			.getByRole('button', {name: new RegExp(`^Code \\(${count}\\)`)});
	await stat.click();
	await expect(page).toHaveURL(/tab=code/);
	await expect(codeTab(2)).toBeVisible();

	await expect.poll(() => server).not.toBeNull();
	const before = sent.length;

	await scrubTo(needle);
	await expect(stat).toHaveText('+3-0');
	await expect(stat).toHaveAttribute('title', '1 commit');
	await expect(codeTab(1)).toBeVisible();

	await scrubTo(stepped);
	await expect(stat).toHaveText('+3-0');
	await scrubTo(needle);
	await expect(stat).toHaveText('+3-0');
	await expect(codeTab(1)).toBeVisible();

	// Each step is drawn from what the page already holds: a step that asked
	// again would draw nothing, or a loading list, until its answer landed, and
	// a dragged needle made the whole board flicker.
	const asked = sent.slice(before);
	expect(asked).not.toContain('diff-stats:get');
	expect(asked).not.toContain('issue:commits:get');

	await returnToLive(page);
	await expect(stat).toHaveText('+5-0');
	await expect(codeTab(2)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
