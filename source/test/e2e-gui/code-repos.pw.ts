import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {
	clonesDirEntries,
	connectByEvent,
	connectedRepos,
	fetchConnectedRepos,
	withNoRepos,
} from './connected-repos.js';

// Another repo connected from the palette: previewed from a staged clone and
// connected only on a confirm, its commits on the ticket they name. Every test
// leaves the worker's board with no repo connected, since every test in this
// worker reads it.

const gitIn =
	(cwd: string) =>
	(...args: string[]) =>
		execFileSync(
			'git',
			['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args],
			{cwd, stdio: 'pipe'},
		)
			.toString()
			.trim();

/** A repo with `init` and, given a ref, a commit naming it. */
const makeUpstream = (ref?: string, subject?: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-gui-upstream-'));
	const git = gitIn(dir);

	git('init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(dir, 'README.md'), 'upstream\n');
	git('add', 'README.md');
	git('commit', '-q', '-m', 'init');
	if (ref) {
		fs.writeFileSync(path.join(dir, `elsewhere-${ref}.txt`), 'one\ntwo\n');
		git('add', '.');
		git('commit', '-q', '-m', `${ref} ${subject}`);
	}

	return dir;
};

const openRepos = async (page: Page) => {
	await page.keyboard.press('Control+k');
	await expect(page.getByTestId('command-palette')).toBeVisible();
	await page.keyboard.type('Connect repo');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('settings-panel')).toBeVisible();
};

/** Opens the slot at the end of the list that takes a URL. */
const startLink = async (page: Page) => {
	await page.getByTestId('connect-a-repo').click();
	await expect(page.getByTestId('repo-url')).toBeVisible();
};

/** Previews a URL from the panel's slot, and waits for its card. */
const previewRepo = async (page: Page, url: string): Promise<Locator> => {
	await startLink(page);
	const modal = page.getByTestId('settings-panel');
	await modal.getByTestId('repo-url').fill(url);
	await modal.getByTestId('connect-repo').click();
	const card = modal.getByTestId('repo-preview');
	await expect(card).toBeVisible();
	return card;
};

const connectRepo = async (page: Page, url: string) => {
	const card = await previewRepo(page, url);
	await card.getByTestId('repo-preview-confirm').click();
	await expect(card).toHaveCount(0);
};

test('a repo is previewed, connected on the confirm, and brings its commits to the ticket they name', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	const sent: string[] = [];
	page.on('websocket', ws =>
		ws.on('framesent', frame => {
			const text = String(frame.payload);
			if (/"repo:(preview|connect)"/.test(text)) sent.push(text);
		}),
	);
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Elsewhere ${stamp}`);
	const subject = `work in another repo ${stamp}`;
	const upstream = makeUpstream(ref, subject);
	const url = `file://${upstream}`;
	const ticketUrl = page.url();
	const projectFile = path.join(repoRoot, '.epiq', 'project.json');
	const projectBefore = fs.readFileSync(projectFile, 'utf8');
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		// The Repos card says how many are connected, the board's own not counted.
		const summary = page.getByTestId('settings-summary-repos');
		await expect(summary).toHaveText('none');

		// The board's own repo is shown, and is not one of the connected rows:
		// nothing to remove, nothing to set.
		const own = modal.getByTestId('own-repo-row');
		await expect(own).toContainText(path.basename(repoRoot));
		await expect(own.getByTestId('disconnect-repo')).toHaveCount(0);
		await expect(own.getByTestId('repo-label')).toHaveCount(0);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);

		// The preview says what the repo is and what connecting it costs.
		const card = await previewRepo(page, url);
		await expect(card.getByTestId('repo-preview-host')).toHaveText(
			'this machine',
		);
		await expect(card.getByTestId('repo-preview-branch')).toHaveText(
			'default branch main',
		);
		await expect(card.getByTestId('repo-preview-latest')).toContainText(
			`${ref} ${subject} · e2e`,
		);
		await expect(card.getByTestId('repo-preview-commits')).toHaveText(
			'2 commits since the board began · 1 name a ticket here',
		);
		await expect(card.getByTestId('repo-preview-warning')).toHaveCount(0);
		await expect(card.getByTestId('repo-preview-size')).toContainText(
			/^\d+(\.\d)? (B|KB|MB) cloned/,
		);
		const confirm = card.getByTestId('repo-preview-confirm');
		await expect(confirm).toContainText(
			/^Connect — every contributor's epiq downloads about \d+(\.\d)? (B|KB|MB) from this machine on their next sync \(\d+ contributors?\)$/,
		);

		// Nothing is written until the confirm.
		expect(connectedRepos(board)).toEqual([]);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		await expect(summary).toHaveText('none');

		await confirm.click();
		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);
		await expect(card).toHaveCount(0);
		await expect(summary).toHaveText('1');
		// The staged clone is the repo's copy: fetched, and its size shown.
		await expect(row.getByTestId('repo-status')).toHaveText(/^fetched /);
		await expect(row.getByTestId('repo-size')).toHaveText(
			/^\d+(\.\d)? (B|KB|MB)$/,
		);
		await expect(modal.getByTestId('repos-claimed')).toHaveText(
			/^Their copies take \d+(\.\d)? (B|KB|MB) on this machine\.$/,
		);
		// The slot closes once the connect landed.
		await expect(modal.getByTestId('repo-url')).toHaveCount(0);
		await expect(modal.getByTestId('connect-a-repo')).toBeVisible();
		expect(connectedRepos(board).map(repo => repo.url)).toEqual([url]);
		expect(fs.readFileSync(projectFile, 'utf8')).toBe(projectBefore);

		// The confirm carries what the preview was made with.
		const payloads = sent.map(text => JSON.parse(text));
		expect(payloads.map(message => message.type)).toEqual([
			'repo:preview',
			'repo:connect',
		]);
		expect(payloads[1].payload).toEqual(payloads[0].payload);

		await modal.getByRole('button', {name: 'close'}).click();

		// The ticket's Code tab reads the clone.
		await page.goto(ticketUrl);
		const aside = page.getByTestId('aside-pane');
		await aside.getByRole('button', {name: /^Code \(1\)/}).click();
		const commit = aside.getByTestId('commit-card');
		await expect(commit).toHaveCount(1);
		await expect(commit).toContainText(subject);
		await expect(commit.getByTestId('commit-repo')).toHaveText(
			path.basename(upstream).toLowerCase(),
		);

		// Its diff is read from the clone, not from the board's own repo.
		await expect(
			aside.getByRole('button', {name: `elsewhere-${ref}.txt`}),
		).toBeVisible();
		await expect(aside.locator('[data-line]')).toHaveCount(2);

		// The gear is the other way in: the overview, with the card to unfold.
		await page.getByTestId('open-settings').click();
		await expect(modal).toBeVisible();
		await page.getByTestId('settings-section-repos').click();
		await row.getByTestId('disconnect-repo').click();
		await row.getByTestId('disconnect-repo').click();
		await expect(row).toHaveCount(0);
		await expect(summary).toHaveText('none');
		// The list says it; no line under it repeats it.
		await expect(modal.getByTestId('repos-last-action')).toHaveCount(0);
		expect(connectedRepos(board)).toEqual([]);
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});

test('a preview whose commits name no ticket warns, and its cancel writes nothing', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	const cancels: string[] = [];
	page.on('websocket', ws =>
		ws.on('framesent', frame => {
			const text = String(frame.payload);
			if (text.includes('"repo:preview:cancel"')) cancels.push(text);
		}),
	);
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const upstream = makeUpstream();
	const url = `file://${upstream}`;
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		const card = await previewRepo(page, url);

		await expect(card.getByTestId('repo-preview-commits')).toHaveText(
			'1 commit since the board began · 0 name a ticket here',
		);
		await expect(card.getByTestId('repo-preview-warning')).toHaveText(
			'None name a ticket here — is this the right repo?',
		);

		await card.getByTestId('repo-preview-cancel').click();
		await expect(card).toHaveCount(0);
		// Back to the field, with the URL to correct.
		await expect(modal.getByTestId('repo-url')).toHaveValue(url);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		await expect.poll(() => cancels.length).toBe(1);
		expect(JSON.parse(cancels[0]!).payload.repo).toBeTruthy();
		expect(connectedRepos(board)).toEqual([]);

		// Nothing arrives later either: a reopened panel lists no repo.
		await modal.getByRole('button', {name: 'close'}).click();
		await openRepos(page);
		await expect(modal.getByTestId('own-repo-row')).toBeVisible();
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		await expect(page.getByTestId('settings-summary-repos')).toHaveText('none');
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});

test('a cancel while the preview clones, or closing the panel, leaves nothing', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	// The preview's answer is held back until the page has cancelled it, so
	// the cancel always lands while the page still waits on the clone.
	const cancels: string[] = [];
	const holds: Array<() => void> = [];
	let delivered = 0;
	await page.routeWebSocket(/.*/, ws => {
		const server = ws.connectToServer();
		ws.onMessage(message => {
			if (String(message).includes('"repo:preview:cancel"')) {
				cancels.push(String(message));
			}
			server.send(message);
		});
		server.onMessage(message => {
			if (!String(message).includes('"for":"repo:preview"')) {
				return ws.send(message);
			}
			holds.push(() => {
				ws.send(message);
				delivered++;
			});
		});
	});
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const upstream = makeUpstream();
	const url = `file://${upstream}`;
	const label = path.basename(upstream).toLowerCase();
	const board = {repoRoot, globalDir};
	const leftovers = () =>
		clonesDirEntries(board).filter(entry => entry.startsWith(label));

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal.getByTestId('repo-url').fill(url);
		await modal.getByTestId('connect-repo').click();
		await expect(modal.getByTestId('repo-preview-pending')).toBeVisible();
		await expect(modal.getByTestId('connect-repo')).toHaveText('cloning…');

		await expect.poll(() => holds.length).toBe(1);
		await modal.getByTestId('connect-repo-cancel').click();
		await expect.poll(() => cancels.length).toBe(1);
		expect(JSON.parse(cancels[0]!).payload).toEqual({url});
		// The field is back, its URL kept, ready to send again.
		await expect(modal.getByTestId('repo-preview-pending')).toHaveCount(0);
		await expect(modal.getByTestId('connect-repo')).toHaveText('connect');
		await expect(modal.getByTestId('repo-url')).toHaveValue(url);

		// The late answer is dropped: no card, no refusal, nothing kept.
		holds.shift()!();
		await expect.poll(() => delivered).toBe(1);
		await page.waitForTimeout(300);
		await expect(modal.getByTestId('repo-preview')).toHaveCount(0);
		await expect(modal.getByTestId('repos-last-action')).toHaveCount(0);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		await expect.poll(leftovers).toEqual([]);

		// Closing the panel while it clones cancels it too.
		await modal.getByTestId('connect-repo').click();
		await expect(modal.getByTestId('repo-preview-pending')).toBeVisible();
		await expect.poll(() => holds.length).toBe(1);
		await modal.getByRole('button', {name: 'close'}).click();
		await expect.poll(() => cancels.length).toBe(2);
		expect(JSON.parse(cancels[1]!).payload).toEqual({url});
		holds.shift()!();
		await expect.poll(() => delivered).toBe(2);

		await openRepos(page);
		await expect(modal.getByTestId('own-repo-row')).toBeVisible();
		await expect(modal.getByTestId('repo-preview')).toHaveCount(0);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		await expect.poll(leftovers).toEqual([]);
		expect(connectedRepos(board)).toEqual([]);
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});

test("a repo that cannot be cloned says git's reason, and a bad URL is refused under the field", async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');

		await startLink(page);
		// Checked as typed, by the rule the server refuses it by: nothing is
		// sent, and the text stays to be corrected.
		await modal.getByTestId('repo-url').fill('/a/local/path');
		await expect(modal.getByTestId('repo-url-problem')).toContainText(
			'not a remote URL',
		);
		await expect(modal.getByTestId('connect-repo')).toBeDisabled();
		await expect(modal.getByTestId('repo-url')).toHaveValue('/a/local/path');

		// The preview's clone fails: git's cause, never the command line it ran,
		// and nothing connected.
		const missing = `file://${path.join(
			os.tmpdir(),
			`epiq-gui-missing-${Date.now()}`,
		)}`;
		await modal.getByTestId('repo-url').fill(missing);
		await modal.getByTestId('connect-repo').click();
		const refusal = modal.getByTestId('repos-last-action');
		await expect(refusal).toContainText(
			'does not appear to be a git repository',
		);
		await expect(refusal).not.toHaveText(/^git |-c |core\.hooksPath/);
		await expect(modal.getByTestId('repo-preview')).toHaveCount(0);
		await expect(modal.getByTestId('repo-url')).toHaveValue(missing);
		await expect(modal.getByTestId('connect-repo')).toBeEnabled();
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);
		expect(connectedRepos(board)).toEqual([]);
	});

	expect(pageErrors).toEqual([]);
});

test('a repo connected but never fetched shows no size, and one past the limit is marked', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const board = {repoRoot, globalDir};
	const urls = Array.from(
		{length: 21},
		(_, index) => `https://example.com/acme/limit-${index}.git`,
	);

	await withNoRepos(board, async () => {
		connectByEvent(board, urls);
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		const rows = modal.getByTestId('repo-row');
		await expect(rows).toHaveCount(21);

		await expect(rows.first().getByTestId('repo-size')).toHaveText('—');
		await expect(modal.getByTestId('repos-claimed')).toHaveText(
			'Their copies take — on this machine.',
		);

		const past = modal.locator(
			'[data-testid="repo-row"][data-over-limit="true"]',
		);
		await expect(past).toHaveCount(1);
		await expect(past.getByTestId('repo-url-shown')).toHaveText(urls[20]!);
		await expect(past.getByTestId('repo-status')).toHaveText(
			'past the limit of 20 · not fetched',
		);
		await expect(rows.first().getByTestId('repo-status')).toHaveText(
			'not fetched yet',
		);
	});

	expect(pageErrors).toEqual([]);
});

test('a repo’s options are written when they change, and only then', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const url = 'https://example.com/acme/options.git';
	const board = {repoRoot, globalDir};
	const options = () =>
		connectedRepos(board).map(({url, branches, since}) => ({
			url,
			branches,
			since,
		}));

	await withNoRepos(board, async () => {
		connectByEvent(board, [url]);
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);

		await row.getByTestId('repo-branches').click();
		await page
			.getByTestId('repo-branches-option')
			.filter({hasText: 'all branches'})
			.click();
		await expect
			.poll(options)
			.toEqual([{url, branches: 'all', since: 'board'}]);

		// Escape with a list open closes the list, and leaves the panel.
		await row.getByTestId('repo-since').click();
		await expect(page.getByTestId('repo-since-option').first()).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('repo-since-option')).toHaveCount(0);
		await expect(modal).toBeVisible();

		await row.getByTestId('repo-since').click();
		await page
			.getByTestId('repo-since-option')
			.filter({hasText: 'since a date'})
			.click();
		const date = row.getByTestId('repo-since-date');
		await date.fill('2025-03-01');
		await date.blur();
		await expect
			.poll(options)
			.toEqual([{url, branches: 'all', since: '2025-03-01'}]);

		// Leaving the date as it is sends nothing. A change after it is the
		// first connect the page sends, and the socket keeps their order.
		const connects: string[] = [];
		page.on('websocket', ws =>
			ws.on('framesent', frame => {
				const text = String(frame.payload);
				if (text.includes('"repo:connect"')) connects.push(text);
			}),
		);
		await page.reload();
		await openRepos(page);
		await date.focus();
		await date.blur();
		await row.getByTestId('repo-branches').click();
		await page
			.getByTestId('repo-branches-option')
			.filter({hasText: 'default branch'})
			.click();
		await expect
			.poll(options)
			.toEqual([{url, branches: 'default', since: '2025-03-01'}]);
		expect(connects).toHaveLength(1);
		expect(connects[0]).toContain('"branches":"default"');
	});

	expect(pageErrors).toEqual([]);
});

// A list is fixed to the window, so one opened past its bottom edge could not
// be scrolled to: it opens upward there instead.
test('a list opened at the bottom of the window opens upward, on screen', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.setViewportSize({width: 1280, height: 640});
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		connectByEvent(board, ['https://example.com/acme/edge.git']);
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		const trigger = modal.getByTestId('repo-row').getByTestId('repo-since');
		await expect(trigger).toBeVisible();

		// Its trigger brought to the window's bottom edge.
		await page.evaluate(`
			const pane = document.querySelector('[data-testid="settings-scroller"]');
			const spacer = document.createElement('div');
			spacer.style.height = '2000px';
			pane.prepend(spacer);
			document
				.querySelector('[data-testid="repo-row"] [data-testid="repo-since"]')
				.scrollIntoView({block: 'end'});
		`);
		await trigger.click();

		const options = page.getByTestId('repo-since-option');
		await expect(options.first()).toBeVisible();
		const list = (await options.last().boundingBox())!;
		expect(list.y + list.height).toBeLessThanOrEqual(640);
		expect((await options.first().boundingBox())!.y).toBeLessThan(
			(await trigger.boundingBox())!.y,
		);

		// A list that grows once open moves up with it, rather than over its
		// trigger.
		await page.evaluate(`
			const grown = document.createElement('div');
			grown.style.height = '80px';
			document
				.querySelector('[data-testid="repo-since-option"]')
				.parentElement.append(grown);
		`);
		const triggerTop = (await trigger.boundingBox())!.y;
		await expect
			.poll(async () => {
				const last = (await options.last().boundingBox())!;
				return last.y + last.height + 80 <= triggerTop;
			})
			.toBe(true);
	});

	expect(pageErrors).toEqual([]);
});

test('the panel keeps focus where it is put while the page redraws', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		connectByEvent(board, ['https://example.com/acme/focus.git']);
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await expect(modal.getByTestId('repo-row')).toHaveCount(1);
		const branches = modal.getByTestId('repo-branches');
		await branches.focus();

		// Another clone's connect lands in the log: this page hears
		// `repos:changed` and redraws.
		connectByEvent(board, ['https://example.com/acme/other.git']);
		await expect(modal.getByTestId('repo-row')).toHaveCount(2);

		await expect(modal.getByTestId('repo-branches').first()).toBeFocused();
	});

	expect(pageErrors).toEqual([]);
});

test('the Code series drops a repo whose box is unticked', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Filtered ${stamp}`);
	const subject = `filtered work ${stamp}`;
	const upstream = makeUpstream(ref, subject);
	const label = path.basename(upstream).toLowerCase();
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await connectRepo(page, `file://${upstream}`);
		await expect(modal.getByTestId('repo-row')).toHaveCount(1);
		await modal.getByRole('button', {name: 'close'}).click();

		await page.reload();
		await expect(page.getByTestId('board-switcher')).toContainText('Default');
		await page.getByTestId('log-toggle').click();
		const line = page.getByTestId('log-line').filter({hasText: subject});
		await expect(line).toHaveCount(1);

		// The chart too, which draws the window it last asked for: the box
		// changes what it draws of that window, not the window.
		const bars = page.getByTestId('commit-bar');
		await expect.poll(async () => await bars.count()).toBeGreaterThan(0);
		const drawn = await bars.count();

		await page.getByTestId('commit-select').click();
		await page
			.getByTestId('commit-repo-toggle')
			.filter({hasText: label})
			.click();
		await expect(line).toHaveCount(0);
		await expect.poll(async () => await bars.count()).toBeLessThan(drawn);

		await page
			.getByTestId('commit-repo-toggle')
			.filter({hasText: label})
			.click();
		await expect(line).toHaveCount(1);
		await expect.poll(async () => await bars.count()).toBe(drawn);
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});

test('a repo labelled in the panel is named so on its commits and in the filter', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Labelled ${stamp}`);
	const subject = `labelled work ${stamp}`;
	const upstream = makeUpstream(ref, subject);
	const ticketUrl = page.url();
	const board = {repoRoot, globalDir};

	await withNoRepos(board, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await connectRepo(page, `file://${upstream}`);
		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);

		const label = row.getByTestId('repo-label');
		await expect(label).toHaveValue(path.basename(upstream).toLowerCase());
		await label.fill('upstream');
		await label.press('Enter');
		await expect.poll(() => connectedRepos(board)[0]?.label).toBe('upstream');
		await expect(modal.getByTestId('repos-last-action')).toHaveCount(0);

		// Refused, and the field keeps what was typed.
		await row.getByTestId('repo-label').fill('Up Stream');
		await row.getByTestId('repo-label').press('Enter');
		await expect(modal.getByTestId('repos-last-action')).toContainText(
			'is not a label',
		);
		await expect(row.getByTestId('repo-label')).toHaveValue('Up Stream');
		await row.getByTestId('repo-label').fill('upstream');

		await fetchConnectedRepos(board);
		await modal.getByRole('button', {name: 'close'}).click();

		await page.goto(ticketUrl);
		const aside = page.getByTestId('aside-pane');
		await aside.getByRole('button', {name: /^Code \(1\)/}).click();
		await expect(
			aside.getByTestId('commit-card').getByTestId('commit-repo'),
		).toHaveText('upstream');

		// And in the Code series' filter, before the panel was ever opened here.
		await page.getByTestId('commit-select').click();
		await expect(
			page.getByTestId('commit-repo-toggle').filter({hasText: 'upstream'}),
		).toHaveCount(1);
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});
