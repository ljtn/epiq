// Builds a shared remote and a set of collaborators against it, then runs them
// as separate processes.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import esbuild from 'esbuild';
import {ulid} from 'ulid';
import {execGit} from '../../git/git-utils.js';
import {deriveActorId} from '../../lib/config/actor-env.js';
import {isFail} from '../../lib/model/result-types.js';
import {getPersistFileName} from '../../lib/event/event-persist.js';
import type {ActorAction, ActorJob, ActorReport} from './protocol.js';

const STATE_BRANCH = 'epiq/state';
const ACTOR_ENTRY = fileURLToPath(new URL('./actor.ts', import.meta.url));

/**
 * The actor, bundled once per worker for fast spawns, run with plain `node`.
 * Under `node_modules`, which resolves externals and is writable in the container.
 */
/** Removes bundles named for a pid that no longer answers `kill(pid, 0)`. */
const sweepDeadBundles = (dir: string): void => {
	for (const name of fs.readdirSync(dir)) {
		const pid = /^epiq-collab-actor\.(\d+)\./.exec(name)?.[1];
		if (pid === undefined || Number(pid) === process.pid) continue;

		try {
			process.kill(Number(pid), 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
				fs.rmSync(path.join(dir, name), {force: true});
			}
		}
	}
};

const buildActor = (): string => {
	// One per module evaluation, since threads share a pid; the pid is kept for sweeping.
	const out = fileURLToPath(
		new URL(
			`../../../node_modules/.cache/epiq-collab-actor.${
				process.pid
			}.${ulid()}.mjs`,
			import.meta.url,
		),
	);

	fs.mkdirSync(path.dirname(out), {recursive: true});
	sweepDeadBundles(path.dirname(out));
	esbuild.buildSync({
		entryPoints: [ACTOR_ENTRY],
		bundle: true,
		packages: 'external',
		platform: 'node',
		format: 'esm',
		target: 'node18',
		// For readable stacks; spawns run with `--enable-source-maps`.
		sourcemap: 'inline',
		outfile: out,
	});

	return out;
};

const ACTOR_BUNDLE = buildActor();

export type Actor = {
	name: string;
	userId: string;
	userName: string;
	repoRoot: string;
	// Identity and the state worktree both live here, so this is what makes two
	// clones two different machines.
	globalDir: string;
	// Set when this identity comes from the environment rather than
	// `config.json` — a second tool on somebody's machine, not a second machine.
	envActorName?: string;
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

/**
 * A second tool on the same machine: same clone and worktree, another identity,
 * derived as `resolveEnvActor` derives it from `EPIQ_USER_NAME`.
 */
export const sameMachineTool = (host: Actor, name: string): Actor => ({
	name,
	userId: deriveActorId(name),
	userName: name.trim().toLowerCase(),
	repoRoot: host.repoRoot,
	globalDir: host.globalDir,
	envActorName: name,
});

export const runActor = async (
	actor: Actor,
	{
		actions,
		sync,
		init = false,
		startDelayMs,
		pauseMs,
	}: {
		actions: ActorAction[];
		sync: boolean;
		init?: boolean;
		startDelayMs?: number;
		pauseMs?: number;
	},
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
		startDelayMs,
		pauseMs,
	};

	const stderr = await new Promise<string>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			['--enable-source-maps', ACTOR_BUNDLE, JSON.stringify(job)],
			{
				cwd: actor.repoRoot,
				env: {
					...process.env,
					EPIQ_GLOBAL_DIR: actor.globalDir,
					IS_LOCAL: 'true',
					...(actor.envActorName ? {EPIQ_USER_NAME: actor.envActorName} : {}),
				},
			},
		);

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

/** Starts an actor and kills it partway through, without waiting for a report. */
/**
 * SIGKILLs an actor's process group a given delay after its sync starts
 * (`syncStartedPath`). `diedMidSync` reports whether the kill landed inside it.
 */
export const runActorAndKill = async (
	actor: Actor,
	{
		actions,
		sync,
		killAfterSyncStartMs,
	}: {
		actions: ActorAction[];
		sync: boolean;
		killAfterSyncStartMs: number;
	},
): Promise<{diedMidSync: boolean}> => {
	const reportPath = path.join(actor.globalDir, `report-${ulid()}.json`);
	const syncStartedPath = path.join(actor.globalDir, `syncing-${ulid()}`);
	const job: ActorJob = {
		repoRoot: actor.repoRoot,
		userId: actor.userId,
		userName: actor.userName,
		actions,
		sync,
		reportPath,
		syncStartedPath,
	};

	await new Promise<void>(resolve => {
		const child = spawn(
			process.execPath,
			['--enable-source-maps', ACTOR_BUNDLE, JSON.stringify(job)],
			{
				cwd: actor.repoRoot,
				stdio: 'ignore',
				// Its own process group, so the kill below reaches the git it
				// spawned rather than orphaning it to finish the work.
				detached: true,
				env: {
					...process.env,
					EPIQ_GLOBAL_DIR: actor.globalDir,
					IS_LOCAL: 'true',
					...(actor.envActorName ? {EPIQ_USER_NAME: actor.envActorName} : {}),
				},
			},
		);

		// Polled: the file appears within a few hundred milliseconds.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = setInterval(() => {
			if (!fs.existsSync(syncStartedPath)) return;

			clearInterval(poll);
			timer = setTimeout(() => {
				try {
					process.kill(-child.pid!, 'SIGKILL');
				} catch {
					// Gone already, which the close handler is about to report.
				}
			}, killAfterSyncStartMs);
		}, 5);

		const done = () => {
			clearInterval(poll);
			clearTimeout(timer);
			resolve();
		};

		child.on('error', done);
		child.on('close', done);
	});

	return {
		diedMidSync: fs.existsSync(syncStartedPath) && !fs.existsSync(reportPath),
	};
};

export const cleanUp = ({dirs}: Collaboration): void => {
	for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
};

/**
 * The actor's state worktree, under its own global dir (`getStateBranchRoot`
 * would read this process's). Exists only after its first sync.
 */
export const stateBranchRootFor = (actor: Actor): string => {
	const project = JSON.parse(
		fs.readFileSync(path.join(actor.repoRoot, '.epiq', 'project.json'), 'utf8'),
	) as {projectId: string};

	return path.join(actor.globalDir, 'worktrees', project.projectId);
};

export const ownLogPathFor = (actor: Actor, fileName: string): string =>
	path.join(stateBranchRootFor(actor), '.epiq', 'events', fileName);

/** The log file this actor writes, named the way `persist` names it. */
export const logFileNameFor = (actor: Actor): string =>
	getPersistFileName({userId: actor.userId});

/** Event ids currently in this actor's own log, straight off disk. */
export const idsInOwnLog = (actor: Actor): string[] => {
	const logPath = ownLogPathFor(actor, logFileNameFor(actor));
	if (!fs.existsSync(logPath)) return [];

	return fs
		.readFileSync(logPath, 'utf8')
		.split('\n')
		.flatMap(line => {
			if (!line.trim()) return [];
			try {
				const id = (JSON.parse(line) as {id?: [string, string | null]}).id;
				return Array.isArray(id) && typeof id[0] === 'string' ? [id[0]] : [];
			} catch {
				return [];
			}
		});
};

/** Appends `raw` verbatim to an actor's own log, bypassing `persist`. */
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
