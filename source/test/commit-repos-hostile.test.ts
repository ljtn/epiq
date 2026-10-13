import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	fetchCommitRepos,
	getCommitDiff,
	getCommitsForRef,
	getCommitTimeline,
	getSquashedDiffForRef,
	listRepoStates,
	readCommitRepos,
	removeCommitRepo,
	removeRepoClone,
	repoIdOf,
	repoUrlProblem,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {
	getRepoClonePath,
	MAX_REPOS,
	projectFileLockPath,
} from '../lib/commits/commit-repos.js';
import {MAX_CLONE_PACKS} from '../lib/commits/commit-repo-fetch.js';
import {execGit} from '../git/git-utils.js';
import {setConfig} from '../lib/config/user-config.js';
import {randomBytes} from 'node:crypto';
import {boot} from '../mcp/api/boot.js';
import {acquireLockFile} from '../git/sync-lock.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

// `project.json` arrives with the code, so its repo list is anybody's who can
// land a commit; and a registered repo's contents are its owner's, not ours.

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[]) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		})
		.toString();

const commit = (
	cwd: string,
	file: string,
	message: string,
	content?: string,
) => {
	fs.writeFileSync(path.join(cwd, file), content ?? `${message}\n`);
	git(cwd, ['add', file]);
	git(cwd, ['commit', '-q', '-m', message]);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

const PROJECT_ID = 'hostile-board';

const writeProject = (root: string, extra: Record<string, unknown> = {}) => {
	fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(root, '.epiq', 'project.json'),
		JSON.stringify(
			{
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
				...extra,
			},
			null,
			2,
		) + '\n',
	);
};

let board: string;
let upstream: string;
let url: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
	git(board, ['init', '-q', '-b', 'main']);
	writeProject(board);
	commit(board, 'init.txt', 'init');
	git(board, ['branch', 'epiq/state']);

	upstream = makeTempDir();
	git(upstream, ['init', '-q', '-b', 'main']);
	commit(upstream, 'init.txt', 'init');
	url = `file://${upstream}`;
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe('a URL from a committed file', () => {
	it.each([
		['ext::sh -c touch% /tmp/pwned', 'runs a command'],
		['fd::17', 'reads a descriptor'],
		['--upload-pack=touch /tmp/pwned', 'is an option'],
		['ssh://-oProxyCommand=touch%20x/repo', 'puts an option in the host'],
		['ssh://-oProxyCommand@host/repo', 'puts an option in the user'],
		['-oProxyCommand=x@host:repo', 'is an scp option'],
		['me@-oProxyCommand=x:repo', 'is an scp host option'],
		['https://user:hunter2@example.com/repo.git', 'commits a password'],
		[
			'https://github.com@evil.example/acme/widgets',
			'passes one host off as another',
		],
		[`https://${'%41'.repeat(300)}@evil.example/x`, 'buries the host'],
		['file://fileserver/share/repo', 'names a host for a file URL'],
		['/home/me/src/repo', 'is a local path'],
		['https://example.com/a repo', 'holds a space'],
		['https://example.com/\x1b]0;pwned\x07', 'holds a control character'],
		['https://exаmple.com/repo', 'hides a lookalike letter'],
		[`https://example.com/${'a'.repeat(3000)}`, 'is far too long'],
		['svn://example.com/repo', 'uses another transport'],
		['file::helper', 'names a remote helper'],
		[
			'git::https://example.com/repo',
			'names a remote helper, and nothing else',
		],
		['https::example.com/repo', 'names a remote helper'],
		['file:relative/path', 'is ssh to a host called file'],
		['file:/etc/repo', 'is not a file:/// URL'],
		['ssh:///repo', 'names no host'],
		[
			'https://github.com\\@127.0.0.1:9/x',
			'reads as one host to the parser and connects to another',
		],
		['https://127.0.0.1:9#@github.com/x', 'hides the host behind a fragment'],
		['https://127.0.0.1:9?@github.com/x', 'hides the host behind a query'],
		[
			'ssh://%2doProxyCommand=touch%20x/repo',
			'puts an option in the host, encoded',
		],
		['ssh://%2d%2doption@host/repo', 'puts an option in the user, encoded'],
		['https://exa%6dple.com/repo', 'encodes its host'],
	])('refuses %j, which %s', bad => {
		expect(repoUrlProblem(bad)).not.toBeNull();
	});

	it.each([
		'https://example.com/a/b.git',
		'http://example.com/a/b.git',
		'ssh://git@example.com:2222/a/b.git',
		'git://example.com/a/b.git',
		'git@example.com:a/b.git',
		'file:///srv/git/b.git',
		'ssh://git@[::1]:2222/a/b.git',
		'https://example.com/a%20b.git',
	])('takes %j', good => {
		expect(repoUrlProblem(good)).toBeNull();
	});

	it('reads no more than the cap, however many are listed', () => {
		writeProject(board, {
			repos: Array.from(
				{length: MAX_REPOS + 30},
				(_, index) => `https://example.com/r${index}.git`,
			),
		});

		expect(value(readCommitRepos(board))).toHaveLength(MAX_REPOS);
	});
});

describe('a remote with no commits yet', () => {
	it('reads as empty, not as unreadable', async () => {
		const empty = makeTempDir();
		git(empty, ['init', '-q', '-b', 'main']);
		value(upsertCommitRepo({repoRoot: board, url: `file://${empty}`}));

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcome!.ok).toBe(true);

		// Read first: only a read can find a clone unreadable.
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toEqual([]);
		const [state] = value(listRepoStates(board));
		expect(state!.error).toBeNull();
	});
});

describe("a repo bigger than this machine's clone cap", () => {
	// Random bytes: git cannot compress them below the cap.
	const addBlob = (name: string, megabytes: number) => {
		fs.writeFileSync(
			path.join(upstream, name),
			randomBytes(megabytes * 1024 * 1024),
		);
		git(upstream, ['add', name]);
		git(upstream, ['commit', '-q', '-m', `AAAAAAA ${name}`]);
	};
	const clonePath = () => getRepoClonePath(PROJECT_ID, repoIdOf(url));
	const leftovers = () =>
		fs
			.readdirSync(path.join(clonePath(), 'objects', 'pack'))
			.filter(name => name.startsWith('tmp_'));

	afterEach(() => {
		setConfig({repoCloneMaxMb: undefined});
	});

	it('is never cloned, and says why', async () => {
		setConfig({repoCloneMaxMb: 1});
		addBlob('big.bin', 4);
		value(upsertCommitRepo({repoRoot: board, url}));

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(outcome!.message).toMatch(/1 MB cap.*repoCloneMaxMb/);
		expect(fs.existsSync(clonePath())).toBe(false);
		expect(
			fs
				.readdirSync(path.dirname(clonePath()))
				.filter(name => name.includes('.pending')),
		).toEqual([]);
	});

	it('stops a fetch that would pass it, and keeps what it held', async () => {
		setConfig({repoCloneMaxMb: 2});
		commit(upstream, 'small.txt', 'AAAAAAA small');
		value(upsertCommitRepo({repoRoot: board, url}));
		expect(value(await fetchCommitRepos({repoRoot: board}))[0]!.ok).toBe(true);

		addBlob('big.bin', 6);
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(outcome!.message).toMatch(/2 MB cap/);
		expect(leftovers()).toEqual([]);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toEqual(['AAAAAAA small']);
	});

	it('undoes a followed default with the fetch, and follows it once it fits', async () => {
		setConfig({repoCloneMaxMb: 2});
		commit(upstream, 'small.txt', 'AAAAAAA small');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		// On the old default alone, and in the clone: read only while that
		// branch is still followed.
		git(upstream, ['branch', 'trunk']);
		commit(upstream, 'only.txt', 'AAAAAAA main only');
		value(await fetchCommitRepos({repoRoot: board}));

		git(upstream, ['checkout', '-q', 'trunk']);
		addBlob('big.bin', 6);
		const [capped] = value(await fetchCommitRepos({repoRoot: board}));
		expect(capped!.message).toMatch(/2 MB cap/);
		expect(fs.readFileSync(path.join(clonePath(), 'HEAD'), 'utf8').trim()).toBe(
			'ref: refs/heads/main',
		);

		setConfig({repoCloneMaxMb: 64});
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toContain('AAAAAAA big.bin');
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).not.toContain('AAAAAAA main only');
	});

	it('leaves a clone already past it unfetched, and readable', async () => {
		commit(upstream, 'small.txt', 'AAAAAAA small');
		addBlob('mid.bin', 2);
		value(upsertCommitRepo({repoRoot: board, url}));
		expect(value(await fetchCommitRepos({repoRoot: board}))[0]!.ok).toBe(true);

		setConfig({repoCloneMaxMb: 1});
		commit(upstream, 'later.txt', 'AAAAAAA later');
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.message).toMatch(/1 MB cap/);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(2);
	});
});

describe('a clone fetched many times', () => {
	it('merges its packs rather than piling them up', async () => {
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		for (let round = 0; round <= MAX_CLONE_PACKS + 1; round++) {
			commit(upstream, 'up.txt', `AAAAAAA round ${round}`);
			value(await fetchCommitRepos({repoRoot: board}));
		}

		const packs = fs
			.readdirSync(
				path.join(
					getRepoClonePath(PROJECT_ID, repoIdOf(url)),
					'objects',
					'pack',
				),
			)
			.filter(name => name.endsWith('.pack'));
		expect(packs.length).toBeLessThanOrEqual(MAX_CLONE_PACKS);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(MAX_CLONE_PACKS + 2);
	}, 60_000);
});

describe("a git that died writing a clone's packs", () => {
	it('leaves nothing the next fetch keeps, or counts against the cap', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		const packDir = path.join(
			getRepoClonePath(PROJECT_ID, repoIdOf(url)),
			'objects',
			'pack',
		);
		// A fetch's and a repack's temp names.
		fs.writeFileSync(path.join(packDir, 'tmp_pack_abc'), 'x'.repeat(1024));
		fs.writeFileSync(path.join(packDir, '.tmp-4242-pack-def.pack'), 'x');

		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			fs
				.readdirSync(packDir)
				.filter(name => name.startsWith('tmp_') || name.startsWith('.tmp-')),
		).toEqual([]);
	});
});

describe('a listed repo nobody has synced', () => {
	// Only a sync reaches the network: a board opened, read and browsed with a
	// repo listed leaves it uncloned.
	it('is not fetched by booting or by any read', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));

		value(await boot(board, {pull: false}));
		value(listRepoStates(board));
		value(await getCommitTimeline({repoRoot: board}));
		value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}));
		await getSquashedDiffForRef({repoRoot: board, ref: 'AAAAAAA'});

		expect(fs.existsSync(getRepoClonePath(PROJECT_ID, repoIdOf(url)))).toBe(
			false,
		);
	});
});

describe('an edit of the repo list while another process edits it', () => {
	it('waits its turn, and is refused rather than written over it', () => {
		const lockPath = projectFileLockPath(board);
		fs.mkdirSync(path.dirname(lockPath), {recursive: true});
		const held = acquireLockFile({lockPath, operation: 'test'});
		expect(held.acquired).toBe(true);

		const refused = upsertCommitRepo({repoRoot: board, url});
		if (held.acquired) held.release();

		expect(isFail(refused) ? refused.message : '').toMatch(/Another process/);
		expect(value(readCommitRepos(board))).toEqual([]);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(removeCommitRepo({repoRoot: board, repo: url}));
		expect(fs.existsSync(lockPath)).toBe(false);
	});
});

describe('a repo list whose lock cannot be made', () => {
	it('refuses the edit rather than throwing', () => {
		const locks = path.dirname(projectFileLockPath(board));
		fs.rmSync(locks, {recursive: true, force: true});
		fs.writeFileSync(locks, 'not a directory');

		try {
			const result = upsertCommitRepo({repoRoot: board, url});

			expect(isFail(result) ? result.message : '').toMatch(/Could not lock/);
			expect(value(readCommitRepos(board))).toEqual([]);
		} finally {
			fs.rmSync(locks, {force: true});
		}
	});
});

describe('a linked repo that is an epiq board', () => {
	it('lends its work, never its event log', async () => {
		fs.mkdirSync(path.join(upstream, '.epiq'));
		fs.writeFileSync(
			path.join(upstream, '.epiq', 'project.json'),
			JSON.stringify({projectId: 'theirs', stateBranch: 'their/log'}),
		);
		git(upstream, ['add', '.epiq']);
		commit(upstream, 'work.txt', 'AAAAAAA their work');
		git(upstream, ['checkout', '-q', '--orphan', 'their/log']);
		commit(upstream, 'event.json', 'AAAAAAA an event about it');
		git(upstream, ['checkout', '-q', 'main']);
		value(upsertCommitRepo({repoRoot: board, url, branches: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		const commits = value(
			await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}),
		);

		expect(commits.map(found => found.subject)).toEqual(['AAAAAAA their work']);
	});
});

describe('a squash whose only clone cannot be read', () => {
	it('says so, rather than that nothing references the ticket', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		// Read once, so the matches are known; then the clone's objects go
		// from under them, as the Code tab's list beside the diff still shows.
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(1);
		fs.rmSync(
			path.join(getRepoClonePath(PROJECT_ID, repoIdOf(url)), 'objects'),
			{
				recursive: true,
			},
		);

		const result = await getSquashedDiffForRef({
			repoRoot: board,
			ref: 'AAAAAAA',
		});

		expect(isFail(result)).toBe(true);
		expect(isFail(result) ? result.message : '').toMatch(/clone/);
	});
});

describe('a clone that cannot be deleted', () => {
	// Permissions bind nobody running as root, who deletes it anyway.
	it.skipIf(process.getuid?.() === 0)(
		'is reported, and its lock let go',
		async () => {
			commit(upstream, 'up.txt', 'AAAAAAA upstream');
			value(upsertCommitRepo({repoRoot: board, url}));
			value(await fetchCommitRepos({repoRoot: board}));

			const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
			const objects = path.join(clonePath, 'objects');
			// A remove that found the clone busy marks it; the next fetch deletes.
			fs.writeFileSync(`${clonePath}.removed`, '');
			// Nothing in it can be unlinked, so the delete throws part way.
			fs.chmodSync(objects, 0o555);

			try {
				const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

				expect(outcome!.ok).toBe(false);
				expect(fs.existsSync(`${clonePath}.lock`)).toBe(false);
				// Moved aside before the delete failed: its own name is free.
				expect(fs.existsSync(clonePath)).toBe(false);
			} finally {
				// Wherever the delete left it, so the dir can go after the test.
				const clones = path.dirname(clonePath);
				for (const name of fs.readdirSync(clones)) {
					const left = path.join(clones, name, 'objects');
					if (fs.existsSync(left)) fs.chmodSync(left, 0o755);
				}
			}
		},
	);
});

describe('a remove that lands while a pass is waiting', () => {
	it('is not undone by a clone of what it removed', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));

		// Held, so the pass reads its list and then waits for the clone.
		const held = acquireLockFile({
			lockPath: `${clonePath}.lock`,
			operation: 'test',
			staleAfterMs: 60_000,
		});
		expect(held.acquired).toBe(true);

		const pass = fetchCommitRepos({repoRoot: board});
		await new Promise(resolve => setTimeout(resolve, 400));
		// Let go first, so the remove finds the clone free and deletes it
		// itself; the pass, still asleep, wakes to what the remove left.
		if (held.acquired) held.release();
		value(removeCommitRepo({repoRoot: board, repo: url}));
		value(removeRepoClone({repoRoot: board, repoId: repoIdOf(url)}));

		const [outcome] = value(await pass);

		expect(outcome!.message).toBe('Removed before it was cloned');
		expect(fs.existsSync(clonePath)).toBe(false);
	});

	it('is not undone when another worktree passes first', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		const otherUpstream = makeTempDir();
		git(otherUpstream, ['init', '-q', '-b', 'main']);
		commit(otherUpstream, 'o.txt', 'BBBBBBB other');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));

		// A second worktree of the board, on a branch listing another repo.
		const sibling = makeTempDir();
		writeProject(sibling);
		value(
			upsertCommitRepo({repoRoot: sibling, url: `file://${otherUpstream}`}),
		);

		const held = acquireLockFile({
			lockPath: `${clonePath}.lock`,
			operation: 'test',
			staleAfterMs: 60_000,
		});
		expect(held.acquired).toBe(true);

		const pass = fetchCommitRepos({repoRoot: board});
		await new Promise(resolve => setTimeout(resolve, 400));
		if (held.acquired) held.release();
		value(removeCommitRepo({repoRoot: board, repo: url}));
		value(removeRepoClone({repoRoot: board, repoId: repoIdOf(url)}));
		value(await fetchCommitRepos({repoRoot: sibling}));

		const [outcome] = value(await pass);

		expect(outcome!.message).toBe('Removed before it was cloned');
		expect(fs.existsSync(clonePath)).toBe(false);
	});

	it('can be made twice, the repo re-added between', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		const id = repoIdOf(url);
		for (let round = 0; round < 2; round++) {
			value(upsertCommitRepo({repoRoot: board, url}));
			value(removeCommitRepo({repoRoot: board, repo: url}));
			value(removeRepoClone({repoRoot: board, repoId: id}));
		}

		value(upsertCommitRepo({repoRoot: board, url}));
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(getRepoClonePath(PROJECT_ID, id))).toBe(true);
		expect(fs.existsSync(`${getRepoClonePath(PROJECT_ID, id)}.removed`)).toBe(
			false,
		);
	});
});

describe('a link planted where epiq writes', () => {
	it('is never used as the clone', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		const elsewhere = makeTempDir();
		fs.mkdirSync(path.dirname(clonePath), {recursive: true});
		fs.symlinkSync(elsewhere, clonePath);

		try {
			const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

			expect(outcome!.ok).toBe(false);
			expect(outcome!.message).toMatch(/link/);
			expect(fs.readdirSync(elsewhere)).toEqual([]);
		} finally {
			fs.rmSync(clonePath, {force: true});
		}
	});

	it('is never written through for the ignore file', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		const clonesDir = path.dirname(getRepoClonePath(PROJECT_ID, repoIdOf(url)));
		const planted = path.join(makeTempDir(), 'planted');
		fs.mkdirSync(clonesDir, {recursive: true});
		const ignore = path.join(clonesDir, '.gitignore');
		fs.rmSync(ignore, {force: true});
		fs.symlinkSync(planted, ignore);

		try {
			value(await fetchCommitRepos({repoRoot: board}));

			expect(fs.existsSync(planted)).toBe(false);
		} finally {
			fs.rmSync(ignore, {force: true});
		}
	});
});

describe('a clone that no longer matches the list', () => {
	it('is cloned again from the listed URL, never fetched from where it points', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		git(clonePath, [
			'--git-dir=.',
			'config',
			'remote.origin.url',
			'https://example.com/elsewhere.git',
		]);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			git(clonePath, ['--git-dir=.', 'config', 'remote.origin.url']).trim(),
		).toBe(url);
	});

	it('keeps its clone when the listed URL is only respelled', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		const marker = path.join(clonePath, 'epiq-test-marker');
		fs.writeFileSync(marker, '');

		writeProject(board, {repos: [`${url}.git/`]});
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(marker)).toBe(true);
	});
});

describe('a clone a killed git left behind', () => {
	// A server shut down mid-fetch, or a fetch timed out and killed, leaves
	// git's own lock files; each one would fail every fetch after it.
	it('is fetched again past the locks it left', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		fs.writeFileSync(path.join(clonePath, 'refs', 'heads', 'main.lock'), '');
		fs.writeFileSync(path.join(clonePath, 'shallow.lock'), '');
		commit(upstream, 'up.txt', 'AAAAAAA second');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(2);
	});
});

describe('a clock and a clone that move under a fetch', () => {
	it('is not held off by a clock set back past the last fetch', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const statusFile = `${getRepoClonePath(PROJECT_ID, repoIdOf(url))}.json`;
		const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
		fs.writeFileSync(
			statusFile,
			JSON.stringify({...status, attemptedAt: Date.now() + 3_600_000}),
		);
		commit(upstream, 'up.txt', 'AAAAAAA second');

		const [outcome] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		expect(outcome!.changed).toBe(true);
	});

	it('answers two fetches at once with one, and another process with a skip', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));

		const [first, second] = await Promise.all([
			fetchCommitRepos({repoRoot: board}),
			fetchCommitRepos({repoRoot: board}),
		]);
		// One fetch, answered twice: the very same result.
		expect(second).toBe(first);
		expect(value(first!)[0]!.ok).toBe(true);

		// Another process mid-fetch: its lock, held by a live pid.
		const lockPath = `${getRepoClonePath(PROJECT_ID, repoIdOf(url))}.lock`;
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.ppid,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'fetch',
			}),
		);
		const [skipped] = value(await fetchCommitRepos({repoRoot: board}));
		expect(skipped).toMatchObject({ok: true, message: /Another process/});
		fs.rmSync(lockPath);
	});

	it('reads around a clone deleted underneath it', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		commit(board, 'b.txt', 'AAAAAAA board');

		fs.rmSync(getRepoClonePath(PROJECT_ID, repoIdOf(url)), {
			recursive: true,
		});
		resetCommitTimelineCacheForTests();

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toEqual(['AAAAAAA board']);
	});

	it('clears a project.json write a dead process left in .epiq/', () => {
		const leftover = path.join(board, '.epiq', 'project.json.2147483646.tmp');
		fs.writeFileSync(leftover, '{');

		value(upsertCommitRepo({repoRoot: board, url}));

		expect(fs.existsSync(leftover)).toBe(false);
		expect(fs.readdirSync(path.join(board, '.epiq'))).toEqual(['project.json']);
	});

	it('keeps a clone directory name short enough for Windows', () => {
		expect(
			repoIdOf(`https://example.com/${'a-very-long-repository-name'.repeat(4)}`)
				.length,
		).toBeLessThanOrEqual(24 + 1 + 12);
	});
});

describe('a remote that renames its default branch', () => {
	it('is followed to the new name rather than failing for good', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA on master-to-be');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		git(upstream, ['branch', '-m', 'main', 'trunk']);
		commit(upstream, 'up.txt', 'AAAAAAA after the rename');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toContain('AAAAAAA after the rename');
	});
});

describe('a clone broken on this machine', () => {
	// A cache: whatever broke it here, the next fetch starts it over rather
	// than failing, or reading nothing, for good.
	const clonePath = () => getRepoClonePath(PROJECT_ID, repoIdOf(url));
	const fetched = async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		expect(value(await fetchCommitRepos({repoRoot: board}))[0]!.ok).toBe(true);
	};
	const reads = async () =>
		value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
			entry => entry.subject,
		);

	afterEach(() => {
		setConfig({repoCloneMaxMb: undefined});
	});

	it('is started over when its config is emptied', async () => {
		await fetched();
		fs.writeFileSync(path.join(clonePath(), 'config'), '');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(await reads()).toEqual(['AAAAAAA upstream']);
	});

	it('is started over when its shallow boundary is cut short', async () => {
		setConfig({repoCloneMaxMb: 64});
		commit(upstream, 'old.txt', 'AAAAAAA old');
		value(upsertCommitRepo({repoRoot: board, url, since: '2020-01-02'}));
		git(upstream, ['commit', '-q', '--allow-empty', '-m', 'AAAAAAA new']);
		value(await fetchCommitRepos({repoRoot: board}));
		const shallow = path.join(clonePath(), 'shallow');
		if (!fs.existsSync(shallow)) {
			fs.writeFileSync(shallow, git(clonePath(), ['rev-parse', 'HEAD']));
		}
		fs.writeFileSync(shallow, fs.readFileSync(shallow, 'utf8').slice(0, 17));

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			/^(?:[0-9a-f]{40}\n)*$/.test(
				fs.existsSync(shallow) ? fs.readFileSync(shallow, 'utf8') : '',
			),
		).toBe(true);
	});

	it('is started over when a stopped repack left it doubled past the cap', async () => {
		setConfig({repoCloneMaxMb: 2});
		fs.writeFileSync(
			path.join(upstream, 'mid.bin'),
			randomBytes(1.2 * 1024 * 1024),
		);
		git(upstream, ['add', 'mid.bin']);
		git(upstream, ['commit', '-q', '-m', 'AAAAAAA mid']);
		value(upsertCommitRepo({repoRoot: board, url}));
		expect(value(await fetchCommitRepos({repoRoot: board}))[0]!.ok).toBe(true);
		const packDir = path.join(clonePath(), 'objects', 'pack');
		for (const name of fs.readdirSync(packDir)) {
			fs.copyFileSync(
				path.join(packDir, name),
				path.join(packDir, name.replace('pack-', 'pack-0')),
			);
		}

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(await reads()).toEqual(['AAAAAAA mid']);
	});

	it('is started over once in a while, not every time it breaks', async () => {
		await fetched();
		fs.writeFileSync(path.join(clonePath(), 'config'), '');
		value(await fetchCommitRepos({repoRoot: board}));
		fs.writeFileSync(path.join(clonePath(), 'config'), '');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
	});

	it('is started over again once its backoff passes, hours inside the first', async () => {
		await fetched();
		fs.writeFileSync(path.join(clonePath(), 'config'), '');
		value(await fetchCommitRepos({repoRoot: board}));

		// An hour on: past the backoff, well inside six hours.
		const statusFile = `${clonePath()}.json`;
		const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
		const hourAgo = Date.now() - 60 * 60 * 1000;
		fs.writeFileSync(
			statusFile,
			JSON.stringify({
				...status,
				restartedAt: hourAgo,
				restartTriedAt: hourAgo,
			}),
		);
		fs.writeFileSync(path.join(clonePath(), 'config'), '');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(await reads()).toEqual(['AAAAAAA upstream']);
	});

	it('counts a start-over as done only once the new clone has landed', async () => {
		setConfig({repoCloneMaxMb: 64});
		fs.writeFileSync(
			path.join(upstream, 'mid.bin'),
			randomBytes(3 * 1024 * 1024),
		);
		git(upstream, ['add', 'mid.bin']);
		git(upstream, ['commit', '-q', '-m', 'AAAAAAA mid']);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		fs.writeFileSync(path.join(clonePath(), 'config'), '');
		// The remote answers, and the new clone cannot land: past the cap.
		setConfig({repoCloneMaxMb: 1});

		value(await fetchCommitRepos({repoRoot: board}));

		const status = JSON.parse(fs.readFileSync(`${clonePath()}.json`, 'utf8'));
		expect(status.restartedAt).toBeNull();
		expect(status.restartTriedAt).toEqual(expect.any(Number));
		expect(status.restarts).toBe(1);
	});

	it('is not counted against while its remote does not answer', async () => {
		await fetched();
		fs.writeFileSync(path.join(clonePath(), 'config'), '');
		fs.renameSync(upstream, `${upstream}-gone`);

		try {
			for (let round = 0; round < 3; round++) {
				value(await fetchCommitRepos({repoRoot: board}));
			}
		} finally {
			fs.renameSync(`${upstream}-gone`, upstream);
		}

		const status = JSON.parse(fs.readFileSync(`${clonePath()}.json`, 'utf8'));
		expect(status.restarts).toBe(0);
		expect(status.restartTriedAt).toBeNull();
		// Back, it is started over at once.
		expect(value(await fetchCommitRepos({repoRoot: board}))[0]!.ok).toBe(true);
	});

	it.skipIf(process.getuid?.() === 0)(
		'is cloned anew for a failing fetch at most once in six hours of tries',
		async () => {
			await fetched();
			// Its own fetch fails, nothing to write into, while the URL answers.
			commit(upstream, 'more.txt', 'AAAAAAA more');
			const packs = path.join(clonePath(), 'objects', 'pack');
			fs.chmodSync(packs, 0o555);
			const statusFile = `${clonePath()}.json`;
			const hourAgo = Date.now() - 60 * 60 * 1000;
			fs.writeFileSync(
				statusFile,
				JSON.stringify({
					...JSON.parse(fs.readFileSync(statusFile, 'utf8')),
					restartedAt: null,
					restartTriedAt: hourAgo,
					restarts: 1,
				}),
			);

			try {
				value(await fetchCommitRepos({repoRoot: board}));

				// Not tried again: the last try is an hour old.
				expect(JSON.parse(fs.readFileSync(statusFile, 'utf8'))).toMatchObject({
					restartTriedAt: hourAgo,
					restarts: 1,
				});
				expect(
					fs
						.readdirSync(path.dirname(clonePath()))
						.filter(name => name.endsWith('.pending')),
				).toEqual([]);
			} finally {
				const clones = path.dirname(clonePath());
				for (const name of fs.readdirSync(clones)) {
					const left = path.join(clones, name, 'objects', 'pack');
					if (fs.existsSync(left)) fs.chmodSync(left, 0o755);
				}
			}
		},
	);

	it.skipIf(process.getuid?.() === 0)(
		'is swapped for its new clone though the old cannot be cleared',
		async () => {
			await fetched();
			fs.writeFileSync(path.join(clonePath(), 'config'), '');
			fs.chmodSync(path.join(clonePath(), 'objects', 'pack'), 0o555);

			try {
				const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

				expect(outcome!.ok).toBe(true);
				expect(await reads()).toEqual(['AAAAAAA upstream']);
			} finally {
				const clones = path.dirname(clonePath());
				for (const name of fs.readdirSync(clones)) {
					const left = path.join(clones, name, 'objects', 'pack');
					if (fs.existsSync(left)) fs.chmodSync(left, 0o755);
				}
			}
		},
	);

	it('leaves nothing of a delete that was stopped partway', async () => {
		await fetched();
		const aside = `${clonePath()}.${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(
			12,
		)}.deleting`;
		fs.mkdirSync(path.join(aside, 'objects'), {recursive: true});

		value(await fetchCommitRepos({repoRoot: board}));

		expect(fs.existsSync(aside)).toBe(false);
	});
});

describe('a default switch a process was stopped in the middle of', () => {
	// The two states an interrupted follow leaves: HEAD moved and the refspec
	// not yet, or both moved and the old branch not yet dropped. Each is put
	// right by the next fetch, however it was left.
	const clonePath = () => getRepoClonePath(PROJECT_ID, repoIdOf(url));
	const cloneGit = (args: string[]) => git(clonePath(), args).trim();
	const heads = () =>
		cloneGit(['for-each-ref', '--format=%(refname)', 'refs/heads/'])
			.split('\n')
			.filter(Boolean);

	const switched = async () => {
		commit(upstream, 'up.txt', 'AAAAAAA shared');
		value(upsertCommitRepo({repoRoot: board, url}));
		git(upstream, ['branch', 'trunk']);
		commit(upstream, 'only.txt', 'AAAAAAA main only');
		value(await fetchCommitRepos({repoRoot: board}));
		git(upstream, ['checkout', '-q', 'trunk']);
		commit(upstream, 'trunk.txt', 'AAAAAAA on trunk');
	};

	const expectOnTrunk = async () => {
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcome!.ok).toBe(true);
		expect(heads()).toEqual(['refs/heads/trunk']);
		expect(cloneGit(['config', '--get', 'remote.origin.fetch'])).toBe(
			'+refs/heads/trunk:refs/heads/trunk',
		);
		const subjects = value(
			await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}),
		).map(entry => entry.subject);
		expect(subjects).toContain('AAAAAAA on trunk');
		expect(subjects).not.toContain('AAAAAAA main only');
	};

	it('is finished when HEAD moved and the refspec did not', async () => {
		await switched();
		cloneGit(['symbolic-ref', 'HEAD', 'refs/heads/trunk']);

		await expectOnTrunk();
	});

	it('is finished when both moved and the old branch stayed', async () => {
		await switched();
		cloneGit(['update-ref', 'refs/heads/trunk', 'refs/heads/main']);
		cloneGit(['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
		cloneGit([
			'config',
			'remote.origin.fetch',
			'+refs/heads/trunk:refs/heads/trunk',
		]);

		await expectOnTrunk();
	});
});

describe('a remote whose HEAD names a branch it does not have', () => {
	it('goes on fetching the branch it had', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA on main');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		commit(upstream, 'up.txt', 'AAAAAAA later on main');
		git(upstream, ['symbolic-ref', 'HEAD', 'refs/heads/nowhere']);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toContain('AAAAAAA later on main');
	});
});

describe('a remote that makes another branch its default', () => {
	it('is read from that branch from the next fetch on', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA on main');
		git(upstream, ['branch', 'trunk']);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		git(upstream, ['checkout', '-q', 'trunk']);
		commit(upstream, 'up.txt', 'AAAAAAA on trunk');
		git(upstream, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toContain('AAAAAAA on trunk');
	});
});

describe('what a registered repo holds', () => {
	it('cannot put a terminal escape in a subject, a name or an address', async () => {
		fs.writeFileSync(path.join(upstream, 'x.txt'), 'x\n');
		git(upstream, ['add', 'x.txt']);
		childProcess.execFileSync(
			'git',
			['commit', '-q', '-m', 'AAAAAAA safe\x1b]0;pwned\x07 ‮subject'],
			{
				cwd: upstream,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: 'Eve\x1b[2J',
					GIT_AUTHOR_EMAIL: 'eve\x07@example.com',
					GIT_COMMITTER_NAME: 'Eve',
					GIT_COMMITTER_EMAIL: 'eve@example.com',
				},
			},
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const [entry] = value(
			await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}),
		);

		for (const text of [entry!.subject, entry!.author, entry!.authorEmail]) {
			expect(text).not.toMatch(/[\x00-\x1f\x7f-\x9f‪-‮]/);
		}
	});

	it('cannot send a file too big to draw across as text', async () => {
		const sha = commit(
			upstream,
			'huge.txt',
			'AAAAAAA a huge file',
			'line\n'.repeat(2 * 1024 * 1024),
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const diff = value(await getCommitDiff({repoRoot: board, sha}));

		expect(diff.files[0]).toMatchObject({
			path: 'huge.txt',
			isBinary: true,
			after: '',
		});
	});
});

describe('a checkout that looks like a bare repo', () => {
	// A pull request can commit `HEAD`, `objects/` and a `config` of its own at
	// the root; in a checkout named `*.git` that is a bare repository's shape,
	// and treating it as one would run every git call under that config.
	it('is still read through its own .git, not the committed lookalike', async () => {
		const checkout = path.join(makeTempDir(), 'widgets.git');
		fs.mkdirSync(checkout);
		git(checkout, ['init', '-q', '-b', 'main']);
		fs.writeFileSync(path.join(checkout, 'HEAD'), 'ref: refs/heads/main\n');
		fs.mkdirSync(path.join(checkout, 'objects'));
		fs.writeFileSync(path.join(checkout, 'config'), '[core]\n\tbare = true\n');

		const result = value(
			await execGit({cwd: checkout, args: ['rev-parse', '--absolute-git-dir']}),
		);

		expect(fs.realpathSync(result.stdout.trim())).toBe(
			fs.realpathSync(path.join(checkout, '.git')),
		);
	});
});

describe('a project file committed as a link', () => {
	it('is never written through', () => {
		const victim = path.join(makeTempDir(), 'profile');
		fs.writeFileSync(victim, 'export PATH=/usr/bin\n');
		fs.writeFileSync(
			victim,
			JSON.stringify({
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		const before = fs.readFileSync(victim, 'utf8');

		const projectFile = path.join(board, '.epiq', 'project.json');
		fs.rmSync(projectFile);
		fs.symlinkSync(victim, projectFile);

		expect(isFail(upsertCommitRepo({repoRoot: board, url}))).toBe(true);
		expect(fs.readFileSync(victim, 'utf8')).toBe(before);
	});

	it('is never written through a linked .epiq directory either', () => {
		const elsewhere = makeTempDir();
		fs.cpSync(path.join(board, '.epiq'), elsewhere, {recursive: true});
		fs.rmSync(path.join(board, '.epiq'), {recursive: true});
		fs.symlinkSync(elsewhere, path.join(board, '.epiq'));
		const before = fs.readFileSync(
			path.join(elsewhere, 'project.json'),
			'utf8',
		);

		expect(isFail(upsertCommitRepo({repoRoot: board, url}))).toBe(true);
		expect(fs.readFileSync(path.join(elsewhere, 'project.json'), 'utf8')).toBe(
			before,
		);
	});
});
