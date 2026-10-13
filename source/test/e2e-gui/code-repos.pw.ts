import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
import {fetchConnectedRepos} from './connected-repos.js';

// Another repo registered from the palette: fetched on request, its commits on
// the ticket they name, and the project file left exactly as it was found once
// the repo is removed — every test in this worker reads that file.

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

const makeUpstream = (ref: string, subject: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-gui-upstream-'));
	const git = gitIn(dir);

	git('init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(dir, 'README.md'), 'upstream\n');
	git('add', 'README.md');
	git('commit', '-q', '-m', 'init');
	fs.writeFileSync(path.join(dir, `elsewhere-${ref}.txt`), 'one\ntwo\n');
	git('add', '.');
	git('commit', '-q', '-m', `${ref} ${subject}`);

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

/** Runs `body` with the worker's project file put back afterwards, whatever happens. */
const withProjectFile = async (
	repoRoot: string,
	body: (projectFile: string, before: string) => Promise<void>,
) => {
	const projectFile = path.join(repoRoot, '.epiq', 'project.json');
	const before = fs.readFileSync(projectFile, 'utf8');

	try {
		await body(projectFile, before);
	} finally {
		fs.writeFileSync(projectFile, before);
	}
};

test('a repo added from the palette brings its commits to the ticket they name', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Elsewhere ${stamp}`);
	const subject = `work in another repo ${stamp}`;
	const upstream = makeUpstream(ref, subject);
	const ticketUrl = page.url();

	await withProjectFile(repoRoot, async (projectFile, before) => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		// The Repos card says how many are linked, the board's own not counted.
		const summary = page.getByTestId('settings-summary-repos');
		await expect(summary).toHaveText('none');

		// The board's own repo is shown, and is not one of the linked rows:
		// nothing to remove, nothing to set.
		const own = modal.getByTestId('own-repo-row');
		await expect(own).toContainText(path.basename(repoRoot));
		await expect(own.getByTestId('disconnect-repo')).toHaveCount(0);
		await expect(own.getByTestId('repo-label')).toHaveCount(0);
		await expect(modal.getByTestId('repo-row')).toHaveCount(0);

		await startLink(page);
		await modal.getByTestId('repo-url').fill(`file://${upstream}`);
		await modal.getByTestId('connect-repo').click();

		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);
		await expect(summary).toHaveText('1');
		await expect(row.getByTestId('repo-status')).toHaveText('not fetched yet');
		// The slot closes once the add landed.
		await expect(modal.getByTestId('repo-url')).toHaveCount(0);
		await expect(modal.getByTestId('connect-a-repo')).toBeVisible();
		expect(JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos).toEqual([
			{url: `file://${upstream}`, branches: 'default', since: 'board'},
		]);

		// Fetched as a sync would; the panel reads the clone's state on opening.
		await fetchConnectedRepos({repoRoot, globalDir});
		await modal.getByRole('button', {name: 'close'}).click();
		await openRepos(page);
		await expect(row.getByTestId('repo-status')).toHaveText(/^fetched /);
		await modal.getByRole('button', {name: 'close'}).click();

		// The ticket's Code tab reads the clone.
		await page.goto(ticketUrl);
		const aside = page.getByTestId('aside-pane');
		await aside.getByRole('button', {name: /^Code \(1\)/}).click();
		const card = aside.getByTestId('commit-card');
		await expect(card).toHaveCount(1);
		await expect(card).toContainText(subject);
		await expect(card.getByTestId('commit-repo')).toHaveText(
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

		// Back to the bytes it was found in, by the remove itself.
		expect(fs.readFileSync(projectFile, 'utf8')).toBe(before);
	});

	fs.rmSync(upstream, {recursive: true, force: true});
	expect(pageErrors).toEqual([]);
});

test("a repo that cannot be fetched says git's reason, and a bad URL is refused under the field", async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
	globalDir,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await withProjectFile(repoRoot, async () => {
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

		const missing = path.join(os.tmpdir(), `epiq-gui-missing-${Date.now()}`);
		await modal.getByTestId('repo-url').fill(`file://${missing}`);
		await modal.getByTestId('connect-repo').click();
		await expect(modal.getByTestId('repo-row')).toHaveCount(1);
		await fetchConnectedRepos({repoRoot, globalDir});
		await modal.getByRole('button', {name: 'close'}).click();
		await openRepos(page);

		const status = modal.getByTestId('repo-row').getByTestId('repo-status');
		await expect(status).not.toHaveText(/not fetched yet/);
		// git's cause, never the command line it ran.
		await expect(status).toContainText(
			'does not appear to be a git repository',
		);
		await expect(status).not.toHaveText(/^git |-c |core\.hooksPath/);
	});

	expect(pageErrors).toEqual([]);
});

test('a repo’s options are written when they change, and only then', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const url = 'https://example.com/acme/options.git';

	await withProjectFile(repoRoot, async projectFile => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal.getByTestId('repo-url').fill(url);
		await modal.getByTestId('connect-repo').click();
		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);

		await row.getByTestId('repo-branches').click();
		await page
			.getByTestId('repo-branches-option')
			.filter({hasText: 'all branches'})
			.click();
		await expect
			.poll(() => JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos)
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
			.poll(() => JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos)
			.toEqual([{url, branches: 'all', since: '2025-03-01'}]);

		// Leaving the date as it is sends nothing. A change after it is the
		// first add the page sends, and the socket keeps their order.
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
			.poll(() => JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos)
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
}) => {
	await page.setViewportSize({width: 1280, height: 640});
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await withProjectFile(repoRoot, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal
			.getByTestId('repo-url')
			.fill('https://example.com/acme/edge.git');
		await modal.getByTestId('connect-repo').click();
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
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await withProjectFile(repoRoot, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal
			.getByTestId('repo-url')
			.fill('https://example.com/acme/focus.git');
		await modal.getByTestId('connect-repo').click();
		const branches = modal.getByTestId('repo-branches');
		await branches.focus();

		// Another client's add: this page hears `repos:changed` and redraws.
		const other = await page.context().newPage();
		await other.goto(appUrl);
		await expect(other.getByTestId('board-switcher')).toContainText('Default');
		await openRepos(other);
		await startLink(other);
		await other
			.getByTestId('repo-url')
			.fill('https://example.com/acme/other.git');
		await other.getByTestId('connect-repo').click();
		await expect(modal.getByTestId('repo-row')).toHaveCount(2);
		await other.close();

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

	await withProjectFile(repoRoot, async () => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal.getByTestId('repo-url').fill(`file://${upstream}`);
		await modal.getByTestId('connect-repo').click();
		await expect(modal.getByTestId('repo-row')).toHaveCount(1);
		await fetchConnectedRepos({repoRoot, globalDir});
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

	await withProjectFile(repoRoot, async projectFile => {
		await openRepos(page);
		const modal = page.getByTestId('settings-panel');
		await startLink(page);
		await modal.getByTestId('repo-url').fill(`file://${upstream}`);
		await modal.getByTestId('connect-repo').click();
		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);

		const label = row.getByTestId('repo-label');
		await expect(label).toHaveValue(path.basename(upstream).toLowerCase());
		await label.fill('upstream');
		await label.press('Enter');
		await expect
			.poll(
				() => JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos[0].label,
			)
			.toBe('upstream');
		await expect(modal.getByTestId('repos-last-action')).toHaveCount(0);

		// Refused, and the field keeps what was typed.
		await row.getByTestId('repo-label').fill('Up Stream');
		await row.getByTestId('repo-label').press('Enter');
		await expect(modal.getByTestId('repos-last-action')).toContainText(
			'is not a label',
		);
		await expect(row.getByTestId('repo-label')).toHaveValue('Up Stream');
		await row.getByTestId('repo-label').fill('upstream');

		await fetchConnectedRepos({repoRoot, globalDir});
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
