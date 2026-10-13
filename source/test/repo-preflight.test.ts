import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {acquireLockFile, processStartedAt} from '../git/sync-lock.js';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {
	getRepoClonePath,
	getRepoClonesDir,
	readConnectedRepos,
	readRepoProject,
	repoIdOf,
} from '../lib/commits/commit-repos.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodeRef} from '../lib/utils/node-ref.js';
import {
	assumeActor,
	cancelRepoConnect,
	connectRepo,
	createIssue,
	disconnectRepo,
	fetchRepos,
	listBoards,
	listSwimlanes,
} from '../mcp/epiq-api.js';
import {
	commitFile,
	makeTempDir,
	setupRepo,
	useTempHome,
} from './helpers/git-repo.js';
import {connectRepoEvent, disconnectRepoEvent} from './helpers/repo-events.js';

useTempHome();

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = async (cwd: string, args: string[]) =>
	value(await execGit({cwd, args}));

const makeUpstream = async (subjects: string[]) => {
	const dir = makeTempDir();
	await git(dir, ['init', '-q', '-b', 'main']);
	let n = 0;
	for (const subject of subjects) {
		await commitFile({
			repoRoot: dir,
			fileName: `f${n++}.txt`,
			content: subject,
			message: subject,
		});
	}
	return `file://${dir}`;
};

const board = async () => {
	const {repoRoot} = await setupRepo();
	const actor = value(await assumeActor({repoRoot, name: 'claude/tester'}));

	const root = value(getStateBranchRoot({repoRoot}));
	value(
		materializeAndPersistAll(
			[...value(createDefaultEvents(actor))] as AppEvent[],
			root,
		),
	);

	const boards = value(await listBoards({repoRoot}));
	const lanes = value(await listSwimlanes({repoRoot, boardId: boards[0]!.id}));
	const issue = value(
		await createIssue({repoRoot, parentId: lanes[0]!.id, title: 'A ticket'}),
	);

	return {repoRoot, ref: nodeRef(issue.id)};
};

const clonePathOf = (repoRoot: string, url: string) =>
	getRepoClonePath(value(readRepoProject(repoRoot)).projectId, repoIdOf(url));

const stagesIn = (repoRoot: string) => {
	const dir = getRepoClonesDir(value(readRepoProject(repoRoot)).projectId);
	return fs.existsSync(dir)
		? fs.readdirSync(dir).filter(name => name.endsWith('.pending'))
		: [];
};

const connected = (repoRoot: string) =>
	value(readConnectedRepos(repoRoot)).live.map(repo => repo.id);

describe('connecting a repo', () => {
	it('previews from a staged clone and writes nothing until it is confirmed', async () => {
		const {repoRoot, ref} = await board();
		const url = await makeUpstream([
			`${ref} first`,
			'unrelated',
			`${ref} more`,
		]);

		const preview = value(await connectRepo({repoRoot, url}));

		expect(preview.preview).toMatchObject({
			host: 'this machine',
			defaultBranch: 'main',
			commits: 3,
			ticketCommits: 2,
			contributors: expect.any(Number),
			latest: {subject: `${ref} more`},
		});
		expect(preview.preview!.bytes).toBeGreaterThan(0);
		expect(connected(repoRoot)).toEqual([]);
		expect(stagesIn(repoRoot)).toHaveLength(1);
		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(false);

		const done = value(await connectRepo({repoRoot, url, confirm: true}));

		expect(done.preview).toBeUndefined();
		expect(connected(repoRoot)).toEqual([repoIdOf(url)]);
		expect(stagesIn(repoRoot)).toEqual([]);
		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(true);
		expect(done.repos[0]).toMatchObject({cloned: true, overLimit: false});
		expect(done.repos[0]!.bytes).toBeGreaterThan(0);
		expect(done.claimedBytes).toBe(done.repos[0]!.bytes);
	});

	it('says when no commit names a ticket here', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one', 'two']);

		const preview = value(await connectRepo({repoRoot, url}));
		expect(preview.preview?.ticketCommits).toBe(0);
		expect(preview.preview?.commits).toBe(2);
	});

	it('refuses a confirm nothing was staged for, and stages nothing doing so', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);

		const result = await connectRepo({repoRoot, url, confirm: true});

		expect(isFail(result)).toBe(true);
		expect(connected(repoRoot)).toEqual([]);
		expect(stagesIn(repoRoot)).toEqual([]);
	});

	it('refuses a confirm with other options than the preview had', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);

		value(await connectRepo({repoRoot, url}));
		const result = await connectRepo({
			repoRoot,
			url,
			since: 'all',
			confirm: true,
		});

		expect(isFail(result)).toBe(true);
		expect(connected(repoRoot)).toEqual([]);
	});

	it('clears the stage on a cancel, writing nothing', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);

		value(await connectRepo({repoRoot, url}));
		value(cancelRepoConnect({repo: repoIdOf(url)}));

		expect(stagesIn(repoRoot)).toEqual([]);
		expect(connected(repoRoot)).toEqual([]);
		expect(isFail(await connectRepo({repoRoot, url, confirm: true}))).toBe(
			true,
		);
	});

	it('keeps no stage when a cancel lands while it is cloning', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);

		const previewing = connectRepo({repoRoot, url});
		// Once the clone has begun: a cancel before the preview is a no-op.
		while (stagesIn(repoRoot).length === 0) {
			await new Promise(resolve => setTimeout(resolve, 1));
		}
		value(cancelRepoConnect({repo: repoIdOf(url)}));

		expect(isFail(await previewing)).toBe(true);
		expect(stagesIn(repoRoot)).toEqual([]);
		expect(connected(repoRoot)).toEqual([]);
	});

	it('keeps one stage at a time, a newer preview taking the place of an older', async () => {
		const {repoRoot} = await board();
		const first = await makeUpstream(['one']);
		const second = await makeUpstream(['two']);

		value(await connectRepo({repoRoot, url: first}));
		value(await connectRepo({repoRoot, url: second}));

		expect(stagesIn(repoRoot)).toHaveLength(1);
		expect(
			isFail(await connectRepo({repoRoot, url: first, confirm: true})),
		).toBe(true);
		value(await connectRepo({repoRoot, url: second, confirm: true}));
		expect(connected(repoRoot)).toEqual([repoIdOf(second)]);
	});

	it('refuses to preview a repo that is already connected', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		value(await connectRepo({repoRoot, url}));
		value(await connectRepo({repoRoot, url, confirm: true}));

		const again = await connectRepo({repoRoot, url, previewOnly: true});

		expect(isFail(again)).toBe(true);
		expect(stagesIn(repoRoot)).toEqual([]);
	});

	it('refuses a remote that does not answer, writing nothing', async () => {
		const {repoRoot} = await board();
		const url = `file://${path.join(makeTempDir(), 'nothing-here')}`;

		expect(isFail(await connectRepo({repoRoot, url}))).toBe(true);
		expect(connected(repoRoot)).toEqual([]);
		expect(stagesIn(repoRoot)).toEqual([]);
	});

	it('changes a connected repo at once, with no preview', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		value(await connectRepo({repoRoot, url}));
		value(await connectRepo({repoRoot, url, confirm: true}));

		const renamed = await connectRepo({repoRoot, url, label: 'upstream'});

		expect(isFail(renamed)).toBe(false);
		expect(value(readConnectedRepos(repoRoot)).live[0]?.label).toBe('upstream');
	});
});

// A write the state took and the log refused must never be read as the log's.
describe('a repo event the log refused', () => {
	const refusingWrites = async <T>(repoRoot: string, fn: () => Promise<T>) => {
		const dir = path.join(
			value(getStateBranchRoot({repoRoot})),
			'.epiq',
			'events',
		);
		const files = fs.readdirSync(dir).map(name => path.join(dir, name));
		for (const file of [...files, dir]) fs.chmodSync(file, 0o500);
		try {
			return await fn();
		} finally {
			for (const file of [dir, ...files]) fs.chmodSync(file, 0o700);
		}
	};

	const anotherWrite = async (repoRoot: string) => {
		const boards = value(await listBoards({repoRoot}));
		const lanes = value(
			await listSwimlanes({repoRoot, boardId: boards[0]!.id}),
		);
		value(
			await createIssue({repoRoot, parentId: lanes[0]!.id, title: 'later'}),
		);
	};

	it.skipIf(process.getuid?.() === 0)(
		'leaves no phantom repo to clone after a confirm the log refused',
		async () => {
			const {repoRoot} = await board();
			const url = await makeUpstream(['one']);
			value(await connectRepo({repoRoot, url}));

			const confirmed = await refusingWrites(repoRoot, () =>
				connectRepo({repoRoot, url, confirm: true}),
			);
			expect(isFail(confirmed)).toBe(true);

			await anotherWrite(repoRoot);
			value(await fetchRepos({repoRoot}));

			expect(connected(repoRoot)).toEqual([]);
			expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(false);
		},
	);

	it.skipIf(process.getuid?.() === 0)(
		'keeps the clone of a repo whose disconnect the log refused',
		async () => {
			const {repoRoot} = await board();
			const url = await makeUpstream(['one']);
			value(await connectRepo({repoRoot, url}));
			value(await connectRepo({repoRoot, url, confirm: true}));

			const disconnected = await refusingWrites(repoRoot, () =>
				disconnectRepo({repoRoot, repo: repoIdOf(url)}),
			);
			expect(isFail(disconnected)).toBe(true);

			await anotherWrite(repoRoot);
			value(await fetchRepos({repoRoot}));

			expect(connected(repoRoot)).toEqual([repoIdOf(url)]);
			expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(true);
		},
	);
});

describe('disconnecting a repo', () => {
	it('writes the event, then deletes this machine clone', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		value(await connectRepo({repoRoot, url}));
		value(await connectRepo({repoRoot, url, confirm: true}));

		value(await disconnectRepo({repoRoot, repo: repoIdOf(url)}));

		expect(fs.existsSync(`${clonePathOf(repoRoot, url)}.removed`)).toBe(false);
		expect(connected(repoRoot)).toEqual([]);
		expect(value(readConnectedRepos(repoRoot)).disconnected).toEqual([
			repoIdOf(url),
		]);
		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(false);
	});

	it('leaves the mark for the fetch holding a clone the disconnect could not delete', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		value(await connectRepo({repoRoot, url}));
		value(await connectRepo({repoRoot, url, confirm: true}));
		const clone = clonePathOf(repoRoot, url);

		// A fetch holding the clone, as one in another process would.
		const lock = acquireLockFile({
			lockPath: `${clone}.lock`,
			operation: 'fetch',
			checkProcess: true,
		});
		if (!lock.acquired) throw new Error('the clone lock is held');
		try {
			value(await disconnectRepo({repoRoot, repo: repoIdOf(url)}));

			expect(fs.existsSync(clone)).toBe(true);
			expect(fs.existsSync(`${clone}.removed`)).toBe(true);
		} finally {
			lock.release();
		}
	});

	it('disconnects a repo this machine never fetched, saying nothing of a clone', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		connectRepoEvent(repoRoot, url, {}, 'TEAMMATE0000000000000000AA');

		const result = await disconnectRepo({repoRoot, repo: repoIdOf(url)});

		expect(isFail(result)).toBe(false);
		expect(!isFail(result) && result.message).toBe(
			`Disconnected ${repoIdOf(url).replace(/-[0-9a-f]{12}$/, '')}`,
		);
	});

	it('clears a clone on the next fetch once a disconnect arrives from elsewhere', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		connectRepoEvent(repoRoot, url, {}, 'TEAMMATE0000000000000000AA');
		value(await fetchRepos({repoRoot}));
		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(true);

		disconnectRepoEvent(repoRoot, url, 'TEAMMATE0000000000000000AA');
		value(await fetchRepos({repoRoot}));

		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(false);
		expect(fs.existsSync(`${clonePathOf(repoRoot, url)}.removed`)).toBe(false);
	});

	it('sweeps a stage whose pid now belongs to a process started after it', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		const clone = clonePathOf(repoRoot, url);
		fs.mkdirSync(path.dirname(clone), {recursive: true});

		// This process's pid, written by one that started long before it.
		const orphan = `${clone}.${process.pid}-978307200000.${'0'.repeat(
			8,
		)}-0000-0000-0000-${'0'.repeat(12)}.pending`;
		fs.mkdirSync(orphan);
		// This process's own, even with its time set back: the name decides.
		const live = `${clone}.${process.pid}-${processStartedAt()}.${'1'.repeat(
			8,
		)}-1111-1111-1111-${'1'.repeat(12)}.pending`;
		fs.mkdirSync(live);
		fs.utimesSync(live, new Date('2001-01-01'), new Date('2001-01-01'));

		value(await fetchRepos({repoRoot}));

		expect(fs.existsSync(orphan)).toBe(false);
		expect(fs.existsSync(live)).toBe(true);
		fs.rmSync(live, {recursive: true, force: true});
	});

	it('keeps a repo reconnected before the sweep, and clones it', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		connectRepoEvent(repoRoot, url, {}, 'TEAMMATE0000000000000000AA');
		value(await fetchRepos({repoRoot}));

		disconnectRepoEvent(repoRoot, url, 'TEAMMATE0000000000000000AA');
		connectRepoEvent(repoRoot, url, {}, 'TEAMMATE0000000000000000AA');
		value(await fetchRepos({repoRoot}));

		expect(connected(repoRoot)).toEqual([repoIdOf(url)]);
		expect(fs.existsSync(clonePathOf(repoRoot, url))).toBe(true);
	});

	it('deletes nothing when the log cannot be read', async () => {
		const {repoRoot} = await board();
		const url = await makeUpstream(['one']);
		connectRepoEvent(repoRoot, url, {}, 'TEAMMATE0000000000000000AA');
		value(await fetchRepos({repoRoot}));

		// No project file: nothing can be read, so nothing may be swept.
		const project = path.join(repoRoot, '.epiq', 'project.json');
		const saved = fs.readFileSync(project, 'utf8');
		const clone = clonePathOf(repoRoot, url);
		fs.writeFileSync(project, '<<<<<<< ours\n');

		expect(isFail(await fetchRepos({repoRoot}))).toBe(true);
		expect(fs.existsSync(clone)).toBe(true);

		fs.writeFileSync(project, saved);
	});
});
