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
	removeCommitRepo,
	removeRepoClone,
	repoIdOf,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {removeRepo} from '../mcp/api/repos.js';
import {
	getRepoClonePath,
	MAX_REPOS,
	REPO_UNCHANGED,
} from '../lib/commits/commit-repos.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {makeTempDir} from './helpers/git-repo.js';

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

const PROJECT = {
	projectId: 'board-under-test',
	stateBranch: 'epiq/state',
	createdAt: '2020-01-01T00:00:00.000Z',
};

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

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = initRepo(makeTempDir());
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

describe('the repos list in project.json', () => {
	it('is empty when the key is absent, as in every file written before it', () => {
		expect(value(readCommitRepos(board))).toEqual([]);
	});

	it('reads URLs written as strings or objects, and defaults the options', () => {
		writeProject(board, {
			repos: [
				'https://example.com/a/one.git',
				{url: 'git@example.com:a/two.git', branches: 'all', since: 'all'},
			],
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

	// The list arrives in a committed file, so a hostile clone writes it.
	it('skips anything that is not a plain remote URL', () => {
		writeProject(board, {
			repos: [
				'ext::sh -c touch% /tmp/pwned',
				'--upload-pack=touch /tmp/pwned',
				'/home/someone/src/project',
				'../sibling',
				{url: 42},
				null,
				'https://example.com/ok.git',
			],
		});

		expect(value(readCommitRepos(board)).map(repo => repo.url)).toEqual([
			'https://example.com/ok.git',
		]);
	});

	it('ignores a repos key that is not a list rather than refusing the file', () => {
		writeProject(board, {repos: {url: 'https://example.com/x.git'}});

		expect(value(readCommitRepos(board))).toEqual([]);
		expect(isFail(readProjectFile(board))).toBe(false);
	});

	it('gives one URL one id on every machine, whatever its spelling', () => {
		expect(repoIdOf('https://Example.com/a/one.git/')).toBe(
			repoIdOf('https://example.com/a/one'),
		);
		expect(repoIdOf('https://example.com/a/one')).toMatch(/^one-[0-9a-f]{12}$/);
	});

	it('refuses a local path or an unknown history window on add', () => {
		expect(
			isFail(upsertCommitRepo({repoRoot: board, url: '/tmp/somewhere'})),
		).toBe(true);
		expect(
			isFail(
				upsertCommitRepo({
					repoRoot: board,
					url: 'https://example.com/x.git',
					since: 'yesterday',
				}),
			),
		).toBe(true);
		expect(value(readCommitRepos(board))).toEqual([]);
	});

	it('changes an existing entry rather than adding a second', () => {
		value(upsertCommitRepo({repoRoot: board, url}));
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `${url}/`,
				branches: 'all',
			}),
		);

		expect(value(readCommitRepos(board))).toMatchObject([
			{url, branches: 'all', since: 'board'},
		]);
	});
});

describe('an add that changes nothing, or one too many', () => {
	it('writes nothing when the repo is already listed just so', () => {
		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));
		const before = projectText(board);
		const file = path.join(board, '.epiq', 'project.json');
		const mtime = fs.statSync(file).mtimeMs;

		const result = upsertCommitRepo({repoRoot: board, url, branches: 'all'});

		expect(isFail(result) ? null : result.message).toBe(REPO_UNCHANGED);
		expect(projectText(board)).toBe(before);
		expect(fs.statSync(file).mtimeMs).toBe(mtime);
	});

	it('refuses a repo past the cap rather than listing one never read', () => {
		writeProject(board, {
			repos: Array.from(
				{length: MAX_REPOS},
				(_, index) => `https://example.com/r${index}.git`,
			),
		});

		expect(
			isFail(
				upsertCommitRepo({
					repoRoot: board,
					url: 'https://example.com/one-more.git',
				}),
			),
		).toBe(true);
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

	it('still reads for a client that predates repos', () => {
		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));

		const parsed = ShippedSchema.safeParse(JSON.parse(projectText(board)));

		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual(PROJECT);
	});

	it('keeps every other key, its order, and keys this build does not know', () => {
		writeProject(board, {futureField: {nested: true}});

		value(upsertCommitRepo({repoRoot: board, url}));

		expect(Object.keys(JSON.parse(projectText(board)))).toEqual([
			'projectId',
			'stateBranch',
			'createdAt',
			'futureField',
			'repos',
		]);
		expect(JSON.parse(projectText(board)).futureField).toEqual({nested: true});
	});

	it('goes back to the exact bytes an older build wrote once the last repo is removed', () => {
		const before = projectText(board);

		value(upsertCommitRepo({repoRoot: board, url}));
		value(removeCommitRepo({repoRoot: board, repo: url}));

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
		value(upsertCommitRepo({repoRoot: board, url}));

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
		const repo = value(upsertCommitRepo({repoRoot: board, url}));

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
		const repo = value(upsertCommitRepo({repoRoot: board, url}));
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
		const repo = value(upsertCommitRepo({repoRoot: board, url}));
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
		value(upsertCommitRepo({repoRoot: board, url}));
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
		value(upsertCommitRepo({repoRoot: board, url}));
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${path.join(makeTempDir(), 'missing')}`,
			}),
		);

		const outcomes = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcomes.map(outcome => outcome.ok)).toEqual([true, false]);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);
	});

	it('records the error on a clone that stops fetching, and keeps its commits', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		value(upsertCommitRepo({repoRoot: board, url}));
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
		const repo = value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT.projectId, repo.id);
		expect(fs.existsSync(clonePath)).toBe(true);

		value(removeCommitRepo({repoRoot: board, repo: repo.id}));
		value(removeRepoClone({repoRoot: board, repoId: repo.id}));

		expect(fs.existsSync(clonePath)).toBe(false);
		resetCommitTimelineCacheForTests();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(1);
	});

	it('is removed from the MCP by its label, clone and cached commits too', async () => {
		commit(upstream, 'up.txt', `${REF_A} upstream`);
		const repo = value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);

		value(await removeRepo({repoRoot: board, repo: repo.label}));

		expect(value(readCommitRepos(board))).toEqual([]);
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
		value(upsertCommitRepo({repoRoot: board, url}));
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
		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);
	});

	it('still clones a repo with nothing in the window, and shows none of it', async () => {
		commit(upstream, 'up.txt', `${REF_A} long ago`, '2019-06-01T00:00:00Z');
		value(upsertCommitRepo({repoRoot: board, url}));

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
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);

		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
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

		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).not.toContain(`${REF_A} on a feature branch`);

		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));
		resetCommitTimelineCacheForTests();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} on a feature branch`);

		value(
			upsertCommitRepo({
				repoRoot: board,
				url,
				branches: 'default',
			}),
		);
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

		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} on a branch`);
	});

	it('lists a commit two sources share once, from the board’s own repo', async () => {
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${board}`,
				since: 'all',
			}),
		);
		value(await fetchCommitRepos({repoRoot: board}));

		const matched = value(
			await getCommitsForRef({repoRoot: board, ref: REF_A}),
		);

		expect(matched).toHaveLength(1);
		expect(matched[0]).not.toHaveProperty('repo');
	});

	it('says whether a fetch moved anything, and skips a repo fetched a moment ago', async () => {
		commit(upstream, 'up.txt', `${REF_A} first`);
		value(upsertCommitRepo({repoRoot: board, url}));

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

	it('keeps entries and fields a newer build wrote when it edits the list', () => {
		writeProject(board, {
			repos: [
				{url: 'https://example.com/a.git', auth: 'token-ref'},
				'svn://example.com/not-for-this-build',
			],
		});

		value(
			upsertCommitRepo({
				repoRoot: board,
				url: 'https://example.com/a.git',
				branches: 'all',
			}),
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(removeCommitRepo({repoRoot: board, repo: url}));

		expect(JSON.parse(projectText(board)).repos).toEqual([
			{
				url: 'https://example.com/a.git',
				auth: 'token-ref',
				branches: 'all',
				since: 'board',
			},
			'svn://example.com/not-for-this-build',
		]);
	});

	it('records why a first clone failed, with no clone to put it in', async () => {
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${path.join(makeTempDir(), 'missing')}`,
			}),
		);
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

		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})).map(
				entry => entry.subject,
			),
		).toContain(`${REF_A} first on a side branch`);
	});

	it('does not retry a failing repo on every throttled pass', async () => {
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${path.join(makeTempDir(), 'missing')}`,
			}),
		);
		const [first] = value(await fetchCommitRepos({repoRoot: board}));
		expect(first!.ok).toBe(false);

		// No second try: the status keeps the first attempt's time.
		const [repo] = value(readCommitRepos(board));
		const status = `${getRepoClonePath('board-under-test', repo!.id)}.json`;
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
		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(3);

		// Narrowed: no fetch needed, the clone already holds the window.
		value(
			upsertCommitRepo({
				repoRoot: board,
				url,
				since: '2020-06-01',
			}),
		);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF_A})),
		).toHaveLength(2);
	});

	it('reports a clones directory it cannot create rather than throwing', async () => {
		value(upsertCommitRepo({repoRoot: board, url}));
		const blocker = path.join(makeTempDir(), 'a-file');
		fs.writeFileSync(blocker, '');

		const saved = process.env['EPIQ_GLOBAL_DIR'];
		process.env['EPIQ_GLOBAL_DIR'] = path.join(blocker, 'global');
		try {
			const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
			expect(outcome!.ok).toBe(false);
		} finally {
			process.env['EPIQ_GLOBAL_DIR'] = saved;
		}
	});
});
