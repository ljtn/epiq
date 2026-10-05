import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';

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
	await page.keyboard.type('Code repos');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('repos-modal')).toBeVisible();
};

test('a repo added from the palette brings its commits to the ticket they name', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	const projectFile = path.join(repoRoot, '.epiq', 'project.json');
	const before = fs.readFileSync(projectFile, 'utf8');

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Elsewhere ${stamp}`);
	const subject = `work in another repo ${stamp}`;
	const upstream = makeUpstream(ref, subject);
	const ticketUrl = page.url();

	try {
		await openRepos(page);
		const modal = page.getByTestId('repos-modal');

		await modal.getByTestId('repo-url').fill(`file://${upstream}`);
		await modal.getByTestId('add-repo').click();

		const row = modal.getByTestId('repo-row');
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId('repo-status')).toHaveText(
			'not fetched yet — sync to fetch',
		);
		expect(JSON.parse(fs.readFileSync(projectFile, 'utf8')).repos).toEqual([
			{url: `file://${upstream}`, branches: 'default', since: 'board'},
		]);

		await modal.getByTestId('fetch-repos').click();
		await expect(row.getByTestId('repo-status')).toHaveText(/^fetched /);
		await modal.getByRole('button', {name: 'close'}).click();

		// The ticket's Code tab, which a fetch tells to read its commits again.
		await page.goto(ticketUrl);
		await page
			.getByTestId('aside-pane')
			.getByRole('button', {name: /^Code \(1\)/})
			.click();
		const card = page.getByTestId('commit-card');
		await expect(card).toHaveCount(1);
		await expect(card).toContainText(subject);
		await expect(card.getByTestId('commit-repo')).toHaveText(
			path.basename(upstream).toLowerCase(),
		);

		// Its diff is read from the clone, not from the board's own repo.
		await expect(
			page.getByRole('button', {name: `elsewhere-${ref}.txt`}),
		).toBeVisible();
		await expect(page.locator('[data-line]')).toHaveCount(2);

		await openRepos(page);
		await row.getByTestId('remove-repo').click();
		await row.getByTestId('remove-repo').click();
		await expect(row).toHaveCount(0);
		await expect(modal.getByTestId('repos-last-action')).toContainText(
			'Removed',
		);
	} finally {
		// Restored whatever happened above: every test in this worker reads it.
		fs.writeFileSync(projectFile, before);
		fs.rmSync(upstream, {recursive: true, force: true});
	}

	expect(fs.readFileSync(projectFile, 'utf8')).toBe(before);
	expect(pageErrors).toEqual([]);
});

// A repo listed by somebody else's commit, not added here: shown, never
// fetched, until somebody on this machine approves it.
test('a repo that arrived in the project file waits for approval before anything is fetched', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	const projectFile = path.join(repoRoot, '.epiq', 'project.json');
	const before = fs.readFileSync(projectFile, 'utf8');

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const ref = await addTicketForRef(page, `Arrived ${stamp}`);
	const upstream = makeUpstream(ref, `listed elsewhere ${stamp}`);

	try {
		fs.writeFileSync(
			projectFile,
			JSON.stringify(
				{...JSON.parse(before), repos: [`file://${upstream}`]},
				null,
				2,
			),
		);

		await openRepos(page);
		const modal = page.getByTestId('repos-modal');
		const row = modal.getByTestId('repo-row');

		await expect(row.getByTestId('repo-status')).toContainText(
			'waiting for approval',
		);

		await modal.getByTestId('fetch-repos').click();
		await expect(modal.getByTestId('repos-last-action')).toContainText(
			'waiting for approval',
		);
		await expect(row.getByTestId('repo-status')).toContainText(
			'waiting for approval',
		);

		await row.getByTestId('approve-repo').click();
		await expect(row.getByTestId('approve-repo')).toHaveCount(0);

		await modal.getByTestId('fetch-repos').click();
		await expect(row.getByTestId('repo-status')).toHaveText(/^fetched /);
	} finally {
		fs.writeFileSync(projectFile, before);
		fs.rmSync(upstream, {recursive: true, force: true});
	}

	expect(pageErrors).toEqual([]);
});
