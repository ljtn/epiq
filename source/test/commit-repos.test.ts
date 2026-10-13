import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {z} from 'zod';
import {
	fetchCommitRepos,
	getCommitDiff,
	getCommitPatch,
	getCommitsForRef,
	getCommitTimeline,
	getSquashedDiffForRef,
	listRepoStates,
	readCommitRepos,
	removeRepoClone,
	repoIdOf,
	repoLabelOfId,
	resetCommitTimelineCacheForTests,
} from '../lib/commits/commits.js';
import {
	findConnectedRepo,
	getRepoClonePath,
	getRepoClonesDir,
	MAX_REPOS,
	planRepoChange,
	readConnectedRepos,
	REPO_RENAMED,
	type CommitRepo,
	type RepoChange,
} from '../lib/commits/commit-repos.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {makeTempDir} from './helpers/git-repo.js';
import {
	connectRepoEvent,
	disconnectRepoEvent,
	editRepoEvent,
	writeRepoEvents,
} from './helpers/repo-events.js';

const REF_A = 'AAAAAAA';
const REF_B = 'BBBBBBB';

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// Dates are set per commit, which `execGit` cannot do: it reads its
// environment once, at import.
const git = (cwd: string, args: string[], date?: string): string =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
				...(date ? {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date} : {}),
			},
		})
		.toString();

const commit = (cwd: string, file: string, message: string, date?: string) => {
	fs.mkdirSync(path.dirname(path.join(cwd, file)), {recursive: true});
	fs.appendFileSync(path.join(cwd, file), `${message}\n`);
	git(cwd, ['add', file]);
	git(cwd, ['commit', '-q', '-m', message], date);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

const initRepo = (dir: string) => {
	git(dir, ['init', '-q', '-b', 'main']);
	return dir;
};

// Its id is the board's own: boards that shared one would share a log.
let PROJECT: {projectId: string; stateBranch: string; createdAt: string};

const writeProject = (root: string, extra: Record<string, unknown> = {}) => {
	fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
	const text = JSON.stringify({...PROJECT, ...extra}, null, 2) + '\n';
	fs.writeFileSync(path.join(root, '.epiq', 'project.json'), text);
	return text;
};

const projectText = (root: string) =>
	fs.readFileSync(path.join(root, '.epiq', 'project.json'), 'utf8');

let board: string;
let upstream: string;
let url: string;

/** Connects a repo and hands it back as the board now lists it. */
const connect = (
	repoUrl: string,
	fields: Parameters<typeof connectRepoEvent>[2] = {},
): CommitRepo => {
	connectRepoEvent(board, repoUrl, fields);
	return value(findConnectedRepo(board, repoIdOf(repoUrl)));
};

const plan = (change: Omit<RepoChange, 'repoRoot'>) =>
	planRepoChange({repoRoot: board, ...change});

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = initRepo(makeTempDir());
	PROJECT = {
		projectId: path.basename(board),
		stateBranch: 'epiq/state',
		createdAt: '2020-01-01T00:00:00.000Z',
	};
	writeProject(board);
	commit(board, 'init.txt', 'init', '2018-01-01T00:00:00Z');
	git(board, ['branch', PROJECT.stateBranch]);
	commit(board, 'board.txt', `${REF_A} board side`, '2024-01-02T00:00:00Z');

	upstream = initRepo(makeTempDir());
	commit(upstream, 'init.txt', 'init', '2018-01-01T00:00:00Z');
	url = `file://${upstream}`;
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe('the connected repos', () => {
	it('are none on a board with no repo events', () => {
		expect(value(readCommitRepos(board))).toEqual([]);
	});

	it('default the options a connect leaves out', () => {
		connectRepoEvent(board, 'https://example.com/a/one.git');
		connectRepoEvent(board, 'git@example.com:a/two.git', {
			branches: 'all',
			since: 'all',
		});

		expect(
			value(readCommitRepos(board)).map(({url, branches, since, label}) => ({
				url,
				branches,
				since,
				label,
			})),
		).toEqual([
			{
				url: 'https://example.com/a/one.git',
				branches: 'default',
				since: 'board',
				label: 'one',
			},
			{
				url: 'git@example.com:a/two.git',
				branches: 'all',
				since: 'all',
				label: 'two',
			},
		]);
	});

	// The log syncs from every clone of the board, so a hostile one writes it.
	it('skip anything that is not a plain remote URL', () => {
		for (const bad of [
			'ext::sh -c touch% /tmp/pwned',
			'--upload-pack=touch /tmp/pwned',
			'/home/someone/src/project',
			'../sibling',
			42 as unknown as string,
			null as unknown as string,
		]) {
			connectRepoEvent(board, bad);
		}
		connectRepoEvent(board, 'https://example.com/ok.git');

		expect(value(readCommitRepos(board)).map(repo => repo.url)).toEqual([
			'https://example.com/ok.git',
		]);
	});

	it('are not read from a repos key a committed project.json carries', () => {
		writeProject(board, {repos: ['https://example.com/x.git']});

		expect(value(readCommitRepos(board))).toEqual([]);
		expect(isFail(readProjectFile(board))).toBe(false);
	});

	it('gives one URL one id on every machine, whatever its spelling', () => {
		expect(repoIdOf('https://Example.com/a/one.git/')).toBe(
			repoIdOf('https://example.com/a/one'),
		);
		expect(repoIdOf('https://example.com/a/one')).toMatch(/^one-[0-9a-f]{12}$/);
	});

	it('refuses a local path or an unknown history window on connect', () => {
		expect(isFail(plan({url: '/tmp/somewhere'}))).toBe(true);
		expect(
			isFail(plan({url: 'https://example.com/x.git', since: 'yesterday'})),
		).toBe(true);
		expect(value(readCommitRepos(board))).toEqual([]);
	});

	it('changes an existing entry rather than adding a second', () => {
		connectRepoEvent(board, url);
		connectRepoEvent(board, `${url}/`, {branches: 'all'});

		expect(value(readCommitRepos(board))).toMatchObject([
			{url, branches: 'all', since: 'board'},
		]);
	});
});

describe('a connect that changes nothing, or one too many', () => {
	it('plans nothing to write when the repo is already listed just so', () => {
		connectRepoEvent(board, url, {branches: 'all'});

		expect(value(plan({url, branches: 'all'})).kind).toBe('unchanged');
		expect(value(plan({url: `${url}/`})).kind).toBe('unchanged');
	});

	it('lists a repo past the cap apart, never read, until one ahead of it goes', async () => {
		const ahead = Array.from(
			{length: MAX_REPOS},
			(_, index) => `https://example.com/r${index}.git`,
		);
		for (const each of ahead) connectRepoEvent(board, each);
		connectRepoEvent(board, url);

		const repos = value(readConnectedRepos(board));
		expect(repos.live.map(repo => repo.url)).toEqual(ahead);
		expect(repos.overLimit.map(repo => repo.url)).toEqual([url]);
		expect(value(readCommitRepos(board))).toHaveLength(MAX_REPOS);
		expect(
			value(listRepoStates(board)).find(repo => repo.url === url),
		).toMatchObject({overLimit: true});
		expect(
			value(await fetchCommitRepos({repoRoot: board})).map(
				outcome => outcome.id,
			),
		).not.toContain(repoIdOf(url));

		disconnectRepoEvent(board, ahead[0]!);

		expect(value(readCommitRepos(board)).map(repo => repo.url)).toContain(url);
		expect(value(readConnectedRepos(board)).overLimit).toEqual([]);
	});
});

describe('backward compatibility of project.json', () => {
	// The schema as 1.12.1 shipped it. A client already out there reads the
	// file with exactly this, so a file with repos in it has to pass it.
	const ShippedSchema = z.object({
		projectId: z.string().min(1),
		stateBranch: z.string().min(1),
		createdAt: z.iso.datetime(),
	});

	it('still reads for a client that predates repos, with repos connected', () => {
		const before = projectText(board);
		connectRepoEvent(board, url, {branches: 'all'});
		connectRepoEvent(board, 'https://example.com/other.git');
		disconnectRepoEvent(board, 'https://example.com/other.git');

		const parsed = ShippedSchema.safeParse(JSON.parse(projectText(board)));

		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual(PROJECT);
		expect(projectText(board)).toBe(before);
	});

	it('leaves the commit list untouched for a board with no other repos', async () => {
		const timeline = value(await getCommitTimeline({repoRoot: board}));

		expect(timeline).toHaveLength(1);
		expect(timeline[0]).not.toHaveProperty('repo');
	});
});

describe('commits from a registered repo', () => {
	it('shows nothing until a sync has fetched it', async () => {
		commit(
			upstream,
			'up.txt',
			`${REF_A} upstream side`,
			'2024-01-03T00:00:00Z',
		);
		connect(url);

		expect(value(await getCommitTimeline({repoRoot: board}))).toHaveLength(1);
		expect(value(listRepoStates(board))[0]).toMatchObject({
			cloned: false,
			fetchedAt: null,
		});
	});

	it('merges both repos newest first, each commit naming where it is from', async () => {
		const older = commit(
			upstream,
			'up.txt',
			`${REF_A} upstream older`,
			'2024-01-01T00:00:00Z',
		);
		const newer = commit(
			upstream,
			'up.txt',
			`${REF_A} upstream newer`,
			'2024-01-03T00:00:00Z',
		);
		const repo = connect(url);

		const outcomes = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcomes).toEqual([
			{
				id: repo.id,
				label: repo.label,
				ok: true,
				changed: true,
				message: 'Fetched',
			},
		]);

		const matched = value(
			await getCommitsForRef({repoRoot: board, ref: REF_A}),
		);

		expect(matched.map(entry => [entry.subject, entry.repo])).toEqual([
			[`${REF_A} upstream newer`, repo.id],
			[`${REF_A} board side`, undefined],
			[`${REF_A} upstream older`, repo.id],
		]);

		// Adjacency is read inside one repo's history, never across the merge.
		expect(matched[0]!.sha).toBe(newer);
		expect(matched[0]!.precedingSha).toBe(older);
		expect(matched[1]!.precedingSha).toBeNull();
	});

	it('reads a commit from the repo it is in, named or not', async () => {
		const sha = commit(upstream, 'src/up.ts', `${REF_A} upstream`);
		const repo = connect(url);
		value(await fetchCommitRepos({repoRoot: board}));

		const named = value(
			await getCommitDiff({repoRoot: board, sha, repo: repo.id}),
		);
		expect(named.files.map(file => file.path)).toEqual(['src/up.ts']);
		expect(named.repo).toBe(repo.id);

		const found = value(await getCommitDiff({repoRoot: board, sha}));
		expect(found.files.map(file => file.path)).toEqual(['src/up.ts']);

		expect(value(await getCommitPatch({repoRoot: board, sha}))).toContain(
			'src/up.ts',
		);
	});

	it('refuses a repo id nothing is registered under', async () => {
		const sha = commit(upstream, 'up.txt', `${REF_A} upstream`);

		expect(
			isFail(
				await getCommitDiff({repoRoot: board, sha, repo: 'nope-00000000'}),
			),
		).toBe(true);
	});

	it('squashes a ticket per repo and hands back every repo’s files', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		commit(upstream, 'up.txt', `${REF_B} another ticket`);
		const repo = connect(url);
		value(await fetchCommitRepos({repoRoot: board}));

		const diff = value(
			await getSquashedDiffForRef({repoRoot: board, ref: REF_A}),
		);

		expect(diff.files.map(file => [file.path, file.repo]).sort()).toEqual([
			['board.txt', undefined],
			['up.txt', repo.id],
		]);
		expect(diff.commits).toBe(2);
		expect(diff.parts).toHaveLength(2);
	});

	it('keeps the single-repo squashed diff exactly as it was', async () => {
		const diff = value(
			await getSquashedDiffForRef({repoRoot: board, ref: REF_A}),
		);

		expect(diff).not.toHaveProperty('parts');
		expect(diff.files[0]).not.toHaveProperty('repo');
	});

	it('picks up a new commit on the next fetch', async () => {
		commit(upstream, 'up.txt', `${REF_A} first`);
		connect(url);
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);

		commit(upstream, 'up.txt', `${REF_A} second`);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);

		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);
	});

	it('reports a repo it cannot reach and carries on with the rest', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		connect(url);
		connect(`file://${path.join(makeTempDir(), 'missing')}`);

		const outcomes = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcomes.map(outcome => outcome.ok)).toEqual([true, false]);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);
	});

	it('records the error on a clone that stops fetching, and keeps its commits', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		connect(url);
		value(await fetchCommitRepos({repoRoot: board}));

		fs.rmSync(upstream, {recursive: true, force: true});
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(value(listRepoStates(board))[0]!.error).toBeTruthy();
		expect(value(listRepoStates(board))[0]!.fetchedAt).not.toBeNull();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);
	});

	it('removes the clone with the registration', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		const repo = connect(url);
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT.projectId, repo.id);
		expect(fs.existsSync(clonePath)).toBe(true);

		disconnectRepoEvent(board, url);
		value(removeRepoClone({repoRoot: board, repoId: repo.id}));

		expect(fs.existsSync(clonePath)).toBe(false);
		resetCommitTimelineCacheForTests();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(1);
	});

	it('is disconnected by its label, its clone and cached commits going on the next fetch', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		const repo = connect(url);
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);

		const named = value(findConnectedRepo(board, repo.label));
		writeRepoEvents(board, [
			{action: 'disconnect.repo', payload: {repo: named.id}},
		]);
		expect(value(readCommitRepos(board))).toEqual([]);
		value(await fetchCommitRepos({repoRoot: board}));

		expect(fs.existsSync(getRepoClonePath(PROJECT.projectId, repo.id))).toBe(
			false,
		);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(1);
	});
});

describe('how much of a registered repo is cloned', () => {
	it('starts history at the board by default, leaving out the cut', async () => {
		commit(
			upstream,
			'up.txt',
			`${REF_A} before the board`,
			'2019-06-01T00:00:00Z',
		);
		commit(upstream, 'up.txt', `${REF_A} still before`, '2019-07-01T00:00:00Z');
		commit(
			upstream,
			'up.txt',
			`${REF_A} after the board`,
			'2021-01-01T00:00:00Z',
		);
		commit(upstream, 'up.txt', `${REF_A} later still`, '2022-01-01T00:00:00Z');
		connect(url);
		value(await fetchCommitRepos({repoRoot: board}));

		const subjects = value(
			await getCommitsForRef({repoRoot: board, ref: REF_A}),
		).map(entry => entry.subject);

		// The commit just before the window is kept as the shallow boundary,
		// so the first one inside it has a parent to diff against; the
		// boundary itself is left out.
		expect(subjects).toEqual([
			`${REF_A} board side`,
			`${REF_A} later still`,
			`${REF_A} after the board`,
		]);
	});

	it('clones everything for since: all', async () => {
		commit(
			upstream,
			'up.txt',
			`${REF_A} before the board`,
			'2019-06-01T00:00:00Z',
		);
		commit(
			upstream,
			'up.txt',
			`${REF_A} after the board`,
			'2021-01-01T00:00:00Z',
		);
		connect(url, {since: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);
	});

	it('still clones a repo with nothing in the window, and shows none of it', async () => {
		commit(upstream, 'up.txt', `${REF_A} long ago`, '2019-06-01T00:00:00Z');
		connect(url);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(1);
	});

	it('widens to the whole history when the window is changed to all', async () => {
		commit(
			upstream,
			'up.txt',
			`${REF_A} before the board`,
			'2019-06-01T00:00:00Z',
		);
		commit(
			upstream,
			'up.txt',
			`${REF_A} after the board`,
			'2021-01-01T00:00:00Z',
		);
		commit(upstream, 'up.txt', `${REF_A} later`, '2022-01-01T00:00:00Z');
		connect(url);
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);

		connect(url, {since: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(4);
	});

	it('reads the default branch only, unless told all', async () => {
		commit(upstream, 'up.txt', `${REF_A} on main`);
		git(upstream, ['checkout', '-q', '-b', 'feature']);
		commit(upstream, 'feature.txt', `${REF_A} on a feature branch`);
		git(upstream, ['checkout', '-q', 'main']);

		connect(url, {since: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).not.toContain(`${REF_A} on a feature branch`);

		connect(url, {branches: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));
		resetCommitTimelineCacheForTests();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} on a feature branch`);

		connect(url, {branches: 'default'});
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).not.toContain(`${REF_A} on a feature branch`);
	});
});

describe('review fixes', () => {
	it('clones every branch when told all, inside the default window too', async () => {
		commit(upstream, 'up.txt', `${REF_A} on main`, '2024-01-01T00:00:00Z');
		git(upstream, ['checkout', '-q', '-b', 'feature']);
		commit(upstream, 'f.txt', `${REF_A} on a branch`, '2024-02-01T00:00:00Z');
		git(upstream, ['checkout', '-q', 'main']);

		connect(url, {branches: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} on a branch`);
	});

	it('lists a commit two sources share once, from the board’s own repo', async () => {
		connect(`file://${board}`, {since: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));

		const matched = value(
			await getCommitsForRef({repoRoot: board, ref: REF_A}),
		);

		expect(matched).toHaveLength(1);
		expect(matched[0]).not.toHaveProperty('repo');
	});

	it('says whether a fetch moved anything, and skips a repo fetched a moment ago', async () => {
		commit(upstream, 'up.txt', `${REF_A} first`);
		connect(url);

		const [cloned] = value(await fetchCommitRepos({repoRoot: board}));
		expect(cloned!.changed).toBe(true);

		const [idle] = value(await fetchCommitRepos({repoRoot: board}));
		expect(idle!.changed).toBe(false);

		commit(upstream, 'up.txt', `${REF_A} second`);
		const [skipped] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		expect(skipped).toMatchObject({ok: true, changed: false});

		const [moved] = value(await fetchCommitRepos({repoRoot: board}));
		expect(moved!.changed).toBe(true);
	});

	it('reads the fields it knows off an event a newer build wrote', () => {
		writeRepoEvents(board, [
			{
				action: 'connect.repo',
				payload: {
					url: 'https://example.com/a.git',
					branches: 'all',
					auth: 'token-ref',
				} as {url: string},
			},
			{
				action: 'edit.repo',
				payload: {
					repo: repoIdOf('https://example.com/a.git'),
					since: 'all',
					branches: 'some-future-mode',
				} as unknown as {repo: string},
			},
		]);

		expect(value(readCommitRepos(board))).toMatchObject([
			{url: 'https://example.com/a.git', branches: 'all', since: 'all'},
		]);
	});

	it('records why a first clone failed, with no clone to put it in', async () => {
		connect(`file://${path.join(makeTempDir(), 'missing')}`);
		value(await fetchCommitRepos({repoRoot: board}));

		expect(value(listRepoStates(board))[0]).toMatchObject({cloned: false});
		expect(value(listRepoStates(board))[0]!.error).toBeTruthy();
	});

	// `--deepen` extends every shallow boundary, whatever the fetch names; this
	// pins that for a branch whose cut the default branch does not share.
	it('deepens every branch past the window, not only the default', async () => {
		// The branch's own history before the window, so its cut is a commit
		// the default branch does not have.
		git(upstream, ['checkout', '-q', '-b', 'side']);
		commit(upstream, 's.txt', 'side, long ago', '2019-01-01T00:00:00Z');
		commit(
			upstream,
			's.txt',
			`${REF_A} first on a side branch`,
			'2024-03-01T00:00:00Z',
		);
		git(upstream, ['checkout', '-q', 'main']);
		commit(upstream, 'm.txt', 'main moves on', '2024-03-02T00:00:00Z');

		connect(url, {branches: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} first on a side branch`);
	});

	it('does not retry a failing repo on every throttled pass', async () => {
		connect(`file://${path.join(makeTempDir(), 'missing')}`);
		const [first] = value(await fetchCommitRepos({repoRoot: board}));
		expect(first!.ok).toBe(false);

		// No second try: the status keeps the first attempt's time.
		const [repo] = value(readCommitRepos(board));
		const status = `${getRepoClonePath(PROJECT.projectId, repo!.id)}.json`;
		const attempted = JSON.parse(fs.readFileSync(status, 'utf8')).attemptedAt;

		const [throttled] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		expect(throttled).toMatchObject({ok: false, message: first!.message});
		expect(JSON.parse(fs.readFileSync(status, 'utf8')).attemptedAt).toBe(
			attempted,
		);
	});

	it('reads a changed window at once, not after the cache ages out', async () => {
		commit(
			upstream,
			'up.txt',
			`${REF_A} before the board`,
			'2019-06-01T00:00:00Z',
		);
		commit(
			upstream,
			'up.txt',
			`${REF_A} after the board`,
			'2021-01-01T00:00:00Z',
		);
		connect(url, {since: 'all'});
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);

		// Narrowed: no fetch needed, the clone already holds the window.
		connect(url, {since: '2020-06-01'});
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);
	});

	it('reports a clones directory it cannot create rather than throwing', async () => {
		connect(url);
		const blocker = getRepoClonesDir(PROJECT.projectId);
		fs.mkdirSync(path.dirname(blocker), {recursive: true});
		fs.writeFileSync(blocker, '');

		try {
			const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
			expect(outcome!.ok).toBe(false);
		} finally {
			fs.rmSync(blocker);
		}
	});
});

describe('a repo labelled apart from its URL', () => {
	it('reads the label off the event, and the basename where there is none', () => {
		connectRepoEvent(board, 'https://a.example/org/svc.git', {
			label: 'upstream',
		});
		connectRepoEvent(board, 'https://b.example/me/svc.git');
		connectRepoEvent(board, 'https://c.example/x/thing.git', {
			label: 'Not A Label',
		});

		expect(value(readCommitRepos(board)).map(repo => repo.label)).toEqual([
			'upstream',
			'svc',
			'thing',
		]);
	});

	it('is set, kept across an option change, and cleared back to the basename', () => {
		const basename = repoLabelOfId(repoIdOf(url));

		expect(connect(url, {label: 'mirror'})).toMatchObject({label: 'mirror'});

		// Nothing said about the label: it stays.
		expect(value(plan({url, branches: 'all'}))).toMatchObject({
			kind: 'edit',
			event: {repo: repoIdOf(url), branches: 'all'},
		});
		expect(connect(url, {branches: 'all'})).toMatchObject({label: 'mirror'});
		expect(value(plan({url, label: 'mirror'})).kind).toBe('unchanged');

		// The basename itself is no label of its own: planned as a clear.
		expect(value(plan({url, label: basename}))).toMatchObject({
			kind: 'edit',
			event: {label: ''},
		});
		editRepoEvent(board, url, {label: ''});
		expect(value(findConnectedRepo(board, url))).toMatchObject({
			label: basename,
			branches: 'all',
		});
		expect(value(plan({url, label: basename})).kind).toBe('unchanged');
	});

	it('refuses a label another repo carries, and one that is not a label', () => {
		connectRepoEvent(board, 'https://a.example/org/svc.git');

		const taken = plan({url, label: 'svc'});
		expect(isFail(taken) && taken.message).toBe(
			'Another repo is already called svc',
		);
		expect(isFail(plan({url, label: 'Up Stream'}))).toBe(true);
		expect(isFail(plan({url, label: '-x'}))).toBe(true);
		// Shaped like an id, which a removal by id would then find first.
		expect(isFail(plan({url, label: 'svc-0123456789ab'}))).toBe(true);
		expect(value(readCommitRepos(board))).toHaveLength(1);
	});

	it('is kept by the earliest of two connects that claim it', () => {
		connectRepoEvent(board, 'https://a.example/org/svc.git', {label: 'api'});
		connectRepoEvent(board, url, {label: 'api'});

		expect(
			value(readCommitRepos(board)).map(repo => [repo.url, repo.label]),
		).toEqual([
			['https://a.example/org/svc.git', 'api'],
			[url, repoLabelOfId(repoIdOf(url))],
		]);

		disconnectRepoEvent(board, 'https://a.example/org/svc.git');
		expect(value(findConnectedRepo(board, url)).label).toBe('api');
	});

	it('answers a change of label alone as a rename, which moves no commit', () => {
		connectRepoEvent(board, url);

		const renamed = value(plan({url, label: 'mirror'}));
		expect(renamed.kind === 'edit' && renamed.message).toBe(
			`${REPO_RENAMED}mirror`,
		);
		const updated = value(plan({url, label: 'fork', since: 'all'}));
		expect(updated.kind === 'edit' && updated.message).toBe('Updated fork');
	});

	it('is what the repo is found by for a disconnect', () => {
		connectRepoEvent(board, url, {label: 'mirror'});

		const found = value(findConnectedRepo(board, 'mirror'));
		expect(found.url).toBe(url);

		writeRepoEvents(board, [
			{action: 'disconnect.repo', payload: {repo: found.id}},
		]);
		expect(value(readCommitRepos(board))).toEqual([]);
	});
});
