// Builds a shared remote and a set of collaborators against it, then runs them
// as separate processes.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {execGit} from '../../git/git-utils.js';
import {isFail} from '../../lib/model/result-types.js';
import type {ActorAction, ActorJob, ActorReport} from './protocol.js';

const STATE_BRANCH = 'epiq/state';
const ACTOR_ENTRY = new URL('./actor.ts', import.meta.url).pathname;

export type Actor = {
	name: string;
	userId: string;
	userName: string;
	repoRoot: string;
	// Identity and the state worktree both live here, so this is what makes two
	// clones two different machines.
	globalDir: string;
};

export type Collaboration = {
	remoteRoot: string;
	actors: Actor[];
	dirs: string[];
};

const git = async (cwd: string, args: string[]): Promise<void> => {
	const result = await execGit({args, cwd});
	if (isFail(result))
		throw new Error(`git ${args.join(' ')}\n${result.message}`);
};

const tempDir = (dirs: string[], prefix: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

const writeJson = (filePath: string, value: unknown): void => {
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
};

const writeIdentity = (globalDir: string, actor: Actor): void => {
	writeJson(path.join(globalDir, 'config.json'), {
		logLevel: 'info',
		// Off: the run decides when a sync happens, or nothing it asserts is
		// attributable to a particular moment.
		autoSync: null,
		preferredEditor: '',
		userId: actor.userId,
		userName: actor.userName,
		autoSyncIntervalMs: 10_000,
	});
};

/**
 * `projectId` is committed, so every clone shares it — collaborators on one
 * project, not separate projects that happen to share a remote.
 */
export const startCollaboration = async ({
	names,
	sharedIdentityFor = [],
}: {
	names: string[];
	// Names that act as the *same* person from a different clone. That is the
	// case where two writers land on one per-actor log file.
	sharedIdentityFor?: string[][];
}): Promise<Collaboration> => {
	const dirs: string[] = [];
	const remoteRoot = tempDir(dirs, 'epiq-collab-remote-');

	await git(remoteRoot, ['init', '--bare', '-q', '-b', 'main', '.']);

	const identityFor = new Map<string, {userId: string; userName: string}>();
	for (const group of sharedIdentityFor) {
		const shared = {userId: ulid(), userName: group[0] ?? 'shared'};
		for (const name of group) identityFor.set(name, shared);
	}

	const actors: Actor[] = names.map(name => {
		const shared = identityFor.get(name);

		return {
			name,
			userId: shared?.userId ?? ulid(),
			userName: shared?.userName ?? name,
			repoRoot: tempDir(dirs, `epiq-collab-${name}-`),
			globalDir: tempDir(dirs, `epiq-global-${name}-`),
		};
	});

	const [first, ...rest] = actors;
	if (!first) throw new Error('a collaboration needs at least one actor');

	// The founder makes the repo everyone else clones.
	await git(first.repoRoot, ['init', '-q', '-b', 'main', '.']);
	await git(first.repoRoot, ['config', 'user.name', first.userName]);
	await git(first.repoRoot, ['config', 'user.email', `${first.name}@test`]);
	writeJson(path.join(first.repoRoot, '.epiq', 'project.json'), {
		projectId: ulid(),
		stateBranch: STATE_BRANCH,
		createdAt: new Date().toISOString(),
	});
	fs.writeFileSync(path.join(first.repoRoot, 'README.md'), 'collab\n');
	await git(first.repoRoot, ['add', '-A']);
	await git(first.repoRoot, ['commit', '-qm', 'init']);
	await git(first.repoRoot, ['remote', 'add', 'origin', remoteRoot]);
	await git(first.repoRoot, ['push', '-qu', 'origin', 'main']);

	for (const actor of rest) {
		fs.rmSync(actor.repoRoot, {recursive: true, force: true});
		await git(path.dirname(actor.repoRoot), [
			'clone',
			'-q',
			remoteRoot,
			actor.repoRoot,
		]);
		await git(actor.repoRoot, ['config', 'user.name', actor.userName]);
		await git(actor.repoRoot, ['config', 'user.email', `${actor.name}@test`]);
	}

	for (const actor of actors) writeIdentity(actor.globalDir, actor);

	return {remoteRoot, actors, dirs};
};

export const runActor = async (
	actor: Actor,
	{
		actions,
		sync,
		init = false,
	}: {actions: ActorAction[]; sync: boolean; init?: boolean},
): Promise<ActorReport> => {
	const reportPath = path.join(actor.globalDir, `report-${ulid()}.json`);
	const job: ActorJob = {
		repoRoot: actor.repoRoot,
		userId: actor.userId,
		userName: actor.userName,
		actions,
		init,
		sync,
		reportPath,
	};

	const stderr = await new Promise<string>((resolve, reject) => {
		const child = spawn('npx', ['tsx', ACTOR_ENTRY, JSON.stringify(job)], {
			cwd: actor.repoRoot,
			env: {
				...process.env,
				EPIQ_GLOBAL_DIR: actor.globalDir,
				IS_LOCAL: 'true',
			},
		});

		let errorOutput = '';
		child.stderr.on('data', chunk => (errorOutput += String(chunk)));
		child.on('error', reject);
		child.on('close', code =>
			code === 0
				? resolve(errorOutput)
				: reject(
						new Error(
							`${actor.name} exited ${code}\n${errorOutput.slice(-4000)}`,
						),
				  ),
		);
	});

	if (!fs.existsSync(reportPath)) {
		throw new Error(`${actor.name} wrote no report\n${stderr.slice(-4000)}`);
	}

	return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ActorReport;
};

export const cleanUp = ({dirs}: Collaboration): void => {
	for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
};

/**
 * Where this actor's state worktree lives. Resolved the way the app resolves
 * it — the committed project id under the actor's own global dir — rather than
 * by importing `getStateBranchRoot`, which reads `EPIQ_GLOBAL_DIR` off *this*
 * process and so would answer for the wrong machine.
 *
 * Only exists after the actor has synced at least once.
 */
export const stateBranchRootFor = (actor: Actor): string => {
	const project = JSON.parse(
		fs.readFileSync(path.join(actor.repoRoot, '.epiq', 'project.json'), 'utf8'),
	) as {projectId: string};

	return path.join(actor.globalDir, 'worktrees', project.projectId);
};

export const ownLogPathFor = (actor: Actor, fileName: string): string =>
	path.join(stateBranchRootFor(actor), '.epiq', 'events', fileName);

/**
 * Appends bytes to an actor's own log without going through `persist`.
 *
 * This is the whole point of the hostile suite: a peer's log is arbitrary
 * bytes that arrive over git, and nothing on the read path gets to assume a
 * well-behaved writer produced them. `raw` is written verbatim, so a caller
 * can leave off the trailing newline to reproduce a half-written line.
 */
export const appendRawToOwnLog = (
	actor: Actor,
	fileName: string,
	raw: string,
): void => {
	const logPath = ownLogPathFor(actor, fileName);
	fs.mkdirSync(path.dirname(logPath), {recursive: true});
	fs.appendFileSync(logPath, raw, 'utf8');
};

/** Every event id in an actor's state worktree, in file order. */
export const idsInStateWorktree = (actor: Actor): string[] => {
	const dir = path.join(stateBranchRootFor(actor), '.epiq', 'events');
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter(name => name.endsWith('.jsonl'))
		.flatMap(name =>
			fs
				.readFileSync(path.join(dir, name), 'utf8')
				.split('\n')
				.flatMap(line => {
					if (!line.trim()) return [];
					try {
						const id = (JSON.parse(line) as {id?: [string, string | null]}).id;
						return Array.isArray(id) && typeof id[0] === 'string'
							? [id[0]]
							: [];
					} catch {
						return [];
					}
				}),
		);
};
