import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getGlobalConfigDir} from '../lib/storage/global-config-dir.js';
import {git} from './git-commands.js';
import {ORIGIN} from './git-constants.js';

export type GitExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	/** Cut at `maxOutput`, for a caller that asked to keep what arrived. */
	truncated?: boolean;
};

const OUTPUT_PAST = 'Output past';

/** Whether a failed call was stopped for printing more than it may. */
export const isOutputOverflow = (message: string): boolean =>
	message.includes(OUTPUT_PAST);

const TIMED_OUT = 'Git command timed out';

/** Whether a failed call ran out of time, which another try may not. */
export const isGitTimeout = (message: string): boolean =>
	message.includes(TIMED_OUT);

/** A local call on a worktree holding only `.epiq/` answers in milliseconds. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * For calls whose duration scales with data: remote calls, and those that write
 * the worktree, which are worse cut short (half-written state) than slow.
 */
const GIT_SLOW_TIMEOUT_MS = 120_000;

/** Bounds a hostile repo's output, far past any real log or diff. */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;
const MAX_GIT_STDERR = 64 * 1024;

/** The largest file a diff is drawn from; a bigger one is shown as undrawable. */
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

// Matched on argv rather than declared per call site: `execGit` is reached from
// a dozen places and the cost of forgetting one is a truncated fetch.
const SLOW_GIT_SUBCOMMANDS = new Set([
	'fetch',
	'push',
	'pull',
	'clone',
	'ls-remote',
	'rebase',
	'checkout',
	'worktree',
]);

const timeoutFor = (args: string[]): number => {
	// `-c key=value` pairs precede the subcommand.
	const subcommand = subcommandOf(args);

	return subcommand && SLOW_GIT_SUBCOMMANDS.has(subcommand)
		? GIT_SLOW_TIMEOUT_MS
		: GIT_TIMEOUT_MS;
};

// A bare `spawn('git')` has execvp attempt an execve in every PATH directory
// ahead of git's, and each miss costs milliseconds; resolve the path once.
const resolveGitBinary = (): string => {
	const names = process.platform === 'win32' ? ['git.exe', 'git'] : ['git'];

	for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
		if (!dir) continue;

		for (const name of names) {
			const candidate = path.join(dir, name);

			try {
				if (!fs.statSync(candidate).isFile()) continue;
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				continue;
			}
		}
	}

	return 'git';
};

export const GIT_BIN = resolveGitBinary();

// Inherited from a git hook, these would override the `cwd` every call relies on.
const REPOSITORY_OVERRIDES = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_NAMESPACE',
];

export const withoutRepositoryOverrides = (
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv =>
	Object.fromEntries(
		Object.entries(env).filter(
			([name]) => !REPOSITORY_OVERRIDES.includes(name),
		),
	);

export const gitEnv = {
	...withoutRepositoryOverrides(process.env),
	GIT_TERMINAL_PROMPT: '0',
	GIT_ASKPASS: 'echo',
	// BatchMode keeps ssh off /dev/tty, which would SIGTTIN-stop a background process.
	GIT_SSH_COMMAND:
		process.env['GIT_SSH_COMMAND'] ??
		'ssh -o BatchMode=yes -o ConnectTimeout=10',
};

/** The output format every parser here assumes, whatever the user's config says. */
const STABLE_OUTPUT = [
	'-c',
	'diff.noprefix=false',
	'-c',
	'diff.mnemonicPrefix=false',
	'-c',
	'diff.srcPrefix=a/',
	'-c',
	'diff.dstPrefix=b/',
	'-c',
	'log.showSignature=false',
];

// Only the commands whose output is parsed; no other call's argv changes.
const PARSED_SUBCOMMANDS = new Set(['log', 'show', 'diff']);

const subcommandOf = (args: string[]): string | undefined =>
	args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '-c');

const stableOutputFor = (args: string[]): string[] =>
	PARSED_SUBCOMMANDS.has(subcommandOf(args) ?? '') ? STABLE_OUTPUT : [];

/**
 * Config for epiq's clones of other repos, whose contents are untrusted:
 * `attr.tree` stops their `.gitattributes` reaching the user's textconv.
 */
export const cloneGitConfig = (): string[] =>
	[
		'attr.tree=refs/epiq/no-attributes',
		// A directory epiq owns, never created: a fixed path like
		// `/dev/null/x` is one anybody can create on Windows.
		`core.hooksPath=${path.join(getGlobalConfigDir(), 'repos', '.no-hooks')}`,
		'protocol.ext.allow=never',
		'protocol.fd.allow=never',
		// Named, since the clone's environment turns off `file` otherwise.
		'protocol.file.allow=always',
		'submodule.recurse=false',
		'fetch.recurseSubmodules=false',
		'credential.interactive=never',
		// Windows' 260-character limit, which a pack deep in a clone can pass.
		'core.longpaths=true',
		'gc.auto=0',
		'maintenance.auto=false',
		// Every fetch kept as a pack of its own, never unpacked into loose
		// objects: one that took a clone past its size cap goes whole.
		'fetch.unpackLimit=1',
		// Nothing written beside the refs that an undone fetch would leave
		// naming commits it deleted.
		'fetch.writeCommitGraph=false',
		'core.logAllRefUpdates=false',
	].flatMap(setting => ['-c', setting]);

// `<clones>/<project>/<repo id>.git[.<pid>[-<start>][.<uuid>].pending]`, exactly,
// so a user's own repo is never taken for one.
const CLONE_DIR =
	/^[\w-]+[\\/][a-z0-9._-]+-[0-9a-f]{12}\.git(\.\d+(-\d+)?(\.[0-9a-f-]{36})?\.pending)?$/;

const realpathOr = (target: string): string => {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
};

/**
 * Whether `cwd` is one of epiq's clones, judged by location, never contents.
 * Checked as written and as resolved (`/tmp` is `/private/tmp` on macOS).
 */
export const isCloneDir = (cwd: string): boolean => {
	const clones = path.join(getGlobalConfigDir(), 'repos');

	return [
		[path.resolve(clones), path.resolve(cwd)],
		[realpathOr(clones), realpathOr(cwd)],
	].some(([root, dir]) => CLONE_DIR.test(path.relative(root!, dir!)));
};

/** `--git-dir`, since `safe.bareRepository=explicit` refuses a bare repo found by cwd. */
const cloneDirArgs = (cwd: string): string[] =>
	isCloneDir(cwd) ? ['--git-dir=.', ...cloneGitConfig()] : [];

// git's messages read in English, which is what the recoveries match on.
const cloneEnv = {
	...Object.fromEntries(
		Object.entries(gitEnv).filter(([name]) => name !== 'GIT_ALLOW_PROTOCOL'),
	),
	LC_ALL: 'C',
	LANGUAGE: '',
	// Transports come from the config above only, never the user's environment.
	GIT_PROTOCOL_FROM_USER: '0',
};

// Git started for a clone, killed with this process: left running, it holds
// git's lock files in a clone the next process would take for abandoned.
const cloneChildren = new Set<ReturnType<typeof spawn>>();
let killsRegistered = false;

// Its own process group off Windows, so a kill reaches the helpers git starts
// (`index-pack`, `remote-https`) as well.
const OWN_GROUP = process.platform !== 'win32';

const killClone = (child: ReturnType<typeof spawn>, signal: NodeJS.Signals) => {
	try {
		if (OWN_GROUP && child.pid) {
			process.kill(-child.pid, signal);
			return;
		}
	} catch {
		// Not a group of its own, or gone already.
	}
	child.kill(signal);
};

const killCloneChildren = (signal: NodeJS.Signals = 'SIGTERM') => {
	for (const child of cloneChildren) killClone(child, signal);
};

const EXIT_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

let shuttingDown = false;

/** Whether this process was signalled to stop, which explains a clone git failing now. */
export const isShuttingDown = () => shuttingDown;

// Grace before clone gits still running, holding lock files, are killed outright.
const CLONE_KILL_GRACE_MS = 2_000;

/**
 * Kills clone gits with the process, then re-raises the signal without these
 * handlers, since Ink's exit handler stands aside while another is registered.
 */
const registerCloneKills = () => {
	if (killsRegistered) return;
	killsRegistered = true;

	process.once('exit', () => killCloneChildren());
	const handlers = new Map<NodeJS.Signals, () => void>();
	for (const signal of EXIT_SIGNALS) {
		handlers.set(signal, () => {
			shuttingDown = true;
			const raise = () => {
				for (const [other, handler] of handlers) process.off(other, handler);
				process.kill(process.pid, signal);
			};

			killCloneChildren();
			const deadline = Date.now() + CLONE_KILL_GRACE_MS;
			const settle = () => {
				if (cloneChildren.size === 0) return raise();
				if (Date.now() >= deadline) {
					killCloneChildren('SIGKILL');
					return raise();
				}
				setTimeout(settle, 20);
			};
			settle();
		});
	}
	for (const [signal, handler] of handlers) process.once(signal, handler);
};

/** A clone git, killed with this process: spawned after `registerCloneKills`. */
const trackCloneChild = (child: ReturnType<typeof spawn>) => {
	cloneChildren.add(child);
	child.once('close', () => cloneChildren.delete(child));
};

const runGit = ({
	args: givenArgs,
	cwd,
	allowFail,
	timeoutMs: timeoutOverride,
	maxOutput = MAX_GIT_OUTPUT,
	forClone = false,
	keepPartial = false,
	abort,
	input,
}: {
	args: string[];
	cwd: string;
	allowFail: boolean;
	timeoutMs?: number;
	maxOutput?: number;
	forClone?: boolean;
	keepPartial?: boolean;
	abort?: AbortSignal;
	input?: string;
}): Promise<Result<GitExecResult> | GitExecResult> =>
	new Promise(resolve => {
		const inClone = isCloneDir(cwd);
		const clone = inClone || forClone;
		const args = [
			...stableOutputFor(givenArgs),
			...(inClone ? ['--git-dir=.'] : []),
			...(clone ? cloneGitConfig() : []),
			...givenArgs,
		];

		if (!fs.existsSync(cwd)) {
			const message = `Git cwd does not exist: ${cwd}`;

			if (allowFail) {
				resolve({stdout: '', stderr: message, exitCode: 1});
				return;
			}

			resolve(failed(message));
			return;
		}

		if (clone) registerCloneKills();
		const child = spawn(GIT_BIN, args, {
			cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: clone ? cloneEnv : gitEnv,
			detached: clone && OWN_GROUP,
		});
		if (clone) trackCloneChild(child);
		// Stdin errors are dropped (EPIPE answers through 'close'); safe only for
		// commands that read input to EOF.
		child.stdin.on('error', () => {});
		child.stdin.end(input ?? '');
		const kill = (signal: NodeJS.Signals) =>
			clone ? killClone(child, signal) : child.kill(signal);

		let settled = false;
		let stdout = '';
		let stderr = '';

		const finish = (value: Result<GitExecResult> | GitExecResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(value);
		};

		const timeoutMs = timeoutOverride ?? timeoutFor(args);

		// Resolves once the child is gone, since a running git holds lock files; forced past a grace.
		let timedOut = false;
		const timeoutMessage = () =>
			[
				`git ${args.join(' ')}`,
				`cwd=${cwd}`,
				`${TIMED_OUT} after ${timeoutMs}ms`,
			].join('\n');
		const answerTimeout = () =>
			allowFail
				? finish({stdout, stderr: timeoutMessage(), exitCode: 124})
				: finish(failed(timeoutMessage()));

		const timeout = setTimeout(() => {
			timedOut = true;
			kill('SIGTERM');
			setTimeout(() => kill('SIGKILL'), 3_000).unref();
			setTimeout(answerTimeout, 6_000).unref();
		}, timeoutMs);

		// Stopped by its caller, as a timeout is: answered once git has gone,
		// with the caller's reason as the last line.
		let aborted: string | null = null;
		const answerAbort = () => {
			const message = [`git ${args.join(' ')}`, aborted].join('\n');
			if (allowFail) finish({stdout, stderr: message, exitCode: 1});
			else finish(failed(message));
		};
		const onAbort = () => {
			aborted = String(abort?.reason ?? 'stopped');
			kill('SIGTERM');
			setTimeout(() => kill('SIGKILL'), 3_000).unref();
			setTimeout(answerAbort, 6_000).unref();
		};
		if (abort?.aborted) onAbort();
		else abort?.addEventListener('abort', onAbort, {once: true});

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;

			if (stdout.length > maxOutput) {
				kill('SIGTERM');

				if (keepPartial && !allowFail) {
					const kept = stdout.slice(0, maxOutput);
					finish(
						succeeded('Git output cut', {
							stdout: kept.slice(0, kept.lastIndexOf('\n') + 1),
							stderr,
							exitCode: 0,
							truncated: true,
						}),
					);
					return;
				}

				const message = `git ${args.join(
					' ',
				)}\n${OUTPUT_PAST} ${maxOutput} characters; stopped`;
				if (allowFail) {
					finish({stdout: '', stderr: message, exitCode: 1});
				} else {
					finish(failed(message));
				}
			}
		});

		child.stderr.on('data', chunk => {
			if (stderr.length < MAX_GIT_STDERR) stderr += chunk;
		});

		child.on('error', error => {
			if (allowFail) {
				finish({stdout, stderr: error.message, exitCode: 1});
				return;
			}

			finish(
				failed(
					[`git ${args.join(' ')}`, `cwd=${cwd}`, error.message].join('\n'),
				),
			);
		});

		child.on('close', code => {
			abort?.removeEventListener('abort', onAbort);
			if (timedOut) return answerTimeout();
			if (aborted !== null) return answerAbort();

			const exitCode = code ?? 1;

			if (allowFail) {
				finish({stdout, stderr, exitCode});
				return;
			}

			if (exitCode !== 0) {
				finish(
					failed(
						[
							`git ${args.join(' ')}`,
							stderr.trim() || stdout.trim() || 'Git command failed',
						]
							.filter(Boolean)
							.join('\n'),
					),
				);
				return;
			}

			finish(
				succeeded('Git command succeeded', {
					stdout,
					stderr,
					exitCode,
				}),
			);
		});
	});

export const execGit = ({
	args,
	cwd,
	timeoutMs,
	maxOutput,
	forClone,
	keepPartial,
	abort,
	input,
}: {
	args: string[];
	cwd: string;
	/** Written to git's stdin, for a list too long for a command line. */
	input?: string;
	/** Overrides the per-subcommand cap, for a transfer whose size is unknown. */
	timeoutMs?: number;
	/** A tighter output cap, for a read whose size somebody else decides. */
	maxOutput?: number;
	/**
	 * Runs as git in a clone does, for a call made beside one — the clone
	 * itself, into a directory that is not one yet.
	 */
	forClone?: boolean;
	/** Past `maxOutput`, answers with the whole lines that arrived, marked truncated. */
	keepPartial?: boolean;
	/** Stops git, failing with the signal's reason as the last line. */
	abort?: AbortSignal;
}): Promise<Result<GitExecResult>> =>
	runGit({
		args,
		cwd,
		allowFail: false,
		timeoutMs,
		maxOutput,
		forClone,
		keepPartial,
		abort,
		input,
	}) as Promise<Result<GitExecResult>>;

export const execGitAllowFail = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<GitExecResult> =>
	runGit({args, cwd, allowFail: true}) as Promise<GitExecResult>;

// Its own spawn: sizes are sliced off the raw Buffer before decoding, or a
// multi-byte character shifts every later offset.
export const readGitBlobsBatch = (
	hashes: string[],
	cwd: string,
): Promise<Result<Map<string, string>>> =>
	new Promise(resolve => {
		if (hashes.length === 0) {
			resolve(succeeded('No blobs to read', new Map()));
			return;
		}

		const clone = isCloneDir(cwd);
		if (clone) registerCloneKills();
		const child = spawn(
			GIT_BIN,
			[...cloneDirArgs(cwd), 'cat-file', '--batch'],
			{
				cwd,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: clone ? cloneEnv : gitEnv,
			},
		);
		if (clone) trackCloneChild(child);

		const chunks: Buffer[] = [];
		let stderr = '';
		let settled = false;

		const finish = (value: Result<Map<string, string>>) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(value);
		};

		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			finish(
				failed(`git cat-file --batch timed out after ${GIT_TIMEOUT_MS}ms`),
			);
		}, GIT_TIMEOUT_MS);

		let received = 0;
		child.stdout.on('data', (chunk: Buffer) => {
			received += chunk.length;
			if (received > MAX_GIT_OUTPUT) {
				child.kill('SIGTERM');
				finish(
					failed(`git cat-file --batch: past ${MAX_GIT_OUTPUT} bytes; stopped`),
				);
				return;
			}
			chunks.push(chunk);
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', chunk => {
			if (stderr.length < MAX_GIT_STDERR) stderr += chunk;
		});

		child.on('error', error => finish(failed(error.message)));

		child.on('close', code => {
			if (code !== 0) {
				finish(
					failed(
						`git cat-file --batch exited ${code}${stderr ? `\n${stderr}` : ''}`,
					),
				);
				return;
			}

			// `--batch` answers in input order, so `hashes` pairs with each response.
			const buffer = Buffer.concat(chunks);
			const blobs = new Map<string, string>();
			let offset = 0;

			for (const hash of hashes) {
				const newlineIndex = buffer.indexOf(0x0a, offset);
				if (newlineIndex === -1) {
					finish(
						failed(
							`git cat-file --batch output ended before a header for ${hash}`,
						),
					);
					return;
				}

				const header = buffer.toString('utf8', offset, newlineIndex);
				offset = newlineIndex + 1;

				const match = /^[0-9a-f]{4,64} \S+ (\d+)$/.exec(header);
				if (!match || !match[1]) {
					finish(failed(`Unexpected git cat-file --batch header: "${header}"`));
					return;
				}

				const size = Number(match[1]);
				// Left out past the cap rather than decoded: the reader treats a
				// missing blob as one it will not draw.
				if (size <= MAX_BLOB_BYTES) {
					blobs.set(hash, buffer.toString('utf8', offset, offset + size));
				}
				// +1 skips the single trailing newline `--batch` appends after content.
				offset += size + 1;
			}

			finish(succeeded('Read blobs', blobs));
		});

		child.stdin.write(hashes.join('\n') + '\n');
		child.stdin.end();
	});

export const commitAndGetSha = async ({
	cwd,
	message,
	pathspec,
}: {
	cwd: string;
	message: string;
	pathspec?: string[];
}): Promise<Result<string>> => {
	const commitResult = await git.commit({cwd, message, pathspec});

	if (isFail(commitResult)) {
		return failed(`Failed to create commit\n${commitResult.message}`);
	}

	const shaResult = await execGit({
		args: ['rev-parse', 'HEAD'],
		cwd,
	});

	if (isFail(shaResult)) {
		return failed(
			`Commit created, but failed to read HEAD SHA\n${shaResult.message}`,
		);
	}

	return succeeded(
		'Created commit and resolved SHA',
		shaResult.value.stdout.trim(),
	);
};
export const getGitDir = async (repoRoot: string): Promise<Result<string>> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['rev-parse', '--git-dir'],
	});

	if (isFail(result)) return failed(result.message);

	const gitDir = result.value.stdout.trim();

	return succeeded(
		'Resolved git dir',
		path.isAbsolute(gitDir) ? gitDir : path.resolve(repoRoot, gitDir),
	);
};
export const getInProgressGitOperation = async (
	repoRoot: string,
): Promise<Result<string | null>> => {
	const gitDirResult = await getGitDir(repoRoot);
	if (isFail(gitDirResult)) return failed(gitDirResult.message);

	const gitDir = gitDirResult.value;

	const markerFiles: Record<string, string> = {
		MERGE_HEAD: 'merge in progress',
	};

	for (const [file, operation] of Object.entries(markerFiles)) {
		if (fs.existsSync(path.join(gitDir, file))) {
			return succeeded('Checked for in-progress Git operation', operation);
		}
	}

	const rebaseDirs: Record<string, string> = {
		'rebase-merge': 'rebase in progress',
		'rebase-apply': 'rebase in progress',
	};

	for (const [dir, operation] of Object.entries(rebaseDirs)) {
		if (fs.existsSync(path.join(gitDir, dir))) {
			return succeeded('Checked for in-progress Git operation', operation);
		}
	}

	return succeeded('Checked for in-progress Git operation', null);
};

export const hasInProgressGitOperation = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const operationResult = await getInProgressGitOperation(repoRoot);
	if (isFail(operationResult)) return failed(operationResult.message);

	return succeeded(
		'Checked for in-progress Git operation',
		operationResult.value !== null,
	);
};

export const hasRemote = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['remote', 'get-url', ORIGIN],
		cwd: repoRoot,
	});

	const hasRemoteResult = result.exitCode === 0;
	return succeeded(`Checked remote ${hasRemoteResult}`, hasRemoteResult);
};

export const hasRemoteBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['ls-remote', '--heads', ORIGIN, branch],
		cwd: repoRoot,
	});

	if (result.exitCode !== 0) {
		return failed(
			result.stderr.trim() ||
				`Unable to inspect remote branch ${ORIGIN}/${branch}`,
		);
	}

	return succeeded('Checked remote branch', result.stdout.trim().length > 0);
};

export const hasLocalBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Local branch exists', true);
	if (result.exitCode === 1) return succeeded('Local branch missing', false);

	return failed(result.stderr.trim() || `Unable to inspect branch ${branch}`);
};

export const normalizeExistingPath = (p: string): string => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return path.resolve(p);
	}
};

export const hasWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['worktree', 'list', '--porcelain'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	const normalized = normalizeExistingPath(worktreeRoot);
	const exists = result.value.stdout
		.split('\n')
		.filter(line => line.startsWith('worktree '))
		.map(line => line.slice('worktree '.length))
		.map(normalizeExistingPath)
		.includes(normalized);

	return succeeded('Checked worktree registration', exists);
};

export const hasUpstream = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
		cwd: repoRoot,
	});

	return succeeded(
		'Checked upstream',
		result.exitCode === 0 && result.stdout.trim().length > 0,
	);
};

export const getCurrentBranch = async (
	cwd: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		cwd: cwd,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved current branch', result.value.stdout.trim());
};

export const getShortHeadSha = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--short', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved short HEAD sha', result.value.stdout.trim());
};

// Only the reasons a rebase-and-retry can clear. Git prints "failed to push
// some refs" for every rejection, hook declines included.
export const isNonFastForward = (message: string): boolean =>
	message.includes('fetch first') || message.includes('non-fast-forward');

/**
 * Whether a rebase is in progress, by its state directories, never by git's
 * localized messages. `--git-path` resolves them in a linked worktree.
 */
const rebaseInProgress = async (cwd: string): Promise<boolean> => {
	// One spawn for both directories: autosync runs this every few seconds.
	const result = await execGitAllowFail({
		cwd,
		args: ['rev-parse', '--absolute-git-dir'],
	});

	if (result.exitCode !== 0) return false;

	const gitDir = result.stdout.trim();
	if (!gitDir) return false;

	// `rebase-merge` is the interactive and merge backend, `rebase-apply` the
	// am-based one. Either means a rebase is in progress.
	return (
		fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
		fs.existsSync(path.join(gitDir, 'rebase-apply'))
	);
};

const REBASE_ATTEMPTS = 3;
const REBASE_RETRY_DELAY_MS = 120;

const delay = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries a rebase that never started, which an unlocked concurrent append can
 * cause. One that started (its state directory remains) is never retried.
 */
const rebaseWithRetry = async (
	cwd: string,
	ref: string,
): Promise<Result<GitExecResult>> => {
	let result = await git.rebaseOnto({cwd, ref});

	for (let attempt = 1; attempt < REBASE_ATTEMPTS; attempt += 1) {
		if (!isFail(result)) return result;
		if (await rebaseInProgress(cwd)) return result;

		await delay(REBASE_RETRY_DELAY_MS);
		result = await git.rebaseOnto({cwd, ref});
	}

	return result;
};

/**
 * Removes lock files a killed git left at the git dir's top level. The caller
 * must know nobody is working there; `preserve` spares its own lock.
 */
export const clearStaleGitLocks = async (
	cwd: string,
	{preserve = []}: {preserve?: readonly string[]} = {},
): Promise<Result<string[]>> => {
	const gitDirResult = await getGitDir(cwd);
	if (isFail(gitDirResult)) return failed(gitDirResult.message);

	const gitDir = gitDirResult.value;
	const removed: string[] = [];

	for (const name of fs.readdirSync(gitDir)) {
		if (!name.endsWith('.lock')) continue;
		if (preserve.includes(name)) continue;

		try {
			fs.rmSync(path.join(gitDir, name), {force: true});
			removed.push(name);
		} catch {
			// Somebody else got there first, or it is not ours to remove; either
			// way the git that follows will say so in its own words.
		}
	}

	return succeeded('Cleared stale git lock files', removed);
};

/**
 * Removes a killed git's lock on one named branch ref, in the shared common dir.
 * Never a walk, and only inside `refs/heads/`.
 */
export const clearStaleRefLock = async (
	cwd: string,
	branch: string,
): Promise<Result<boolean>> => {
	const commonResult = await execGitAllowFail({
		cwd,
		args: ['rev-parse', '--git-common-dir'],
	});

	if (commonResult.exitCode !== 0) {
		return failed(`Unable to resolve the common git directory at ${cwd}`);
	}

	const commonDir = path.resolve(cwd, commonResult.stdout.trim());
	const headsDir = path.join(commonDir, 'refs', 'heads');
	const lockPath = path.resolve(headsDir, `${branch}.lock`);

	if (!lockPath.startsWith(`${headsDir}${path.sep}`)) {
		return failed(`Refusing to clear a ref lock outside ${headsDir}`);
	}

	if (!fs.existsSync(lockPath)) {
		return succeeded('No ref lock to clear', false);
	}

	try {
		fs.rmSync(lockPath, {force: true});
	} catch {
		// Somebody else got there first, or it is not ours to remove; the git
		// that follows will say so in its own words.
		return succeeded('Ref lock could not be cleared', false);
	}

	return succeeded('Cleared a stale ref lock', true);
};

export const abortRebaseIfPresent = async (
	cwd: string,
): Promise<Result<boolean>> => {
	if (!(await rebaseInProgress(cwd))) {
		return succeeded('No rebase to abort', false);
	}

	const result = await execGitAllowFail({
		cwd,
		args: ['rebase', '--abort'],
	});

	// Failed, not swallowed, or the caller starts a second rebase over the stuck one.
	if (result.exitCode !== 0) {
		return failed(
			`Failed to abort the rebase in progress at ${cwd}\n${result.stderr.trim()}`,
		);
	}

	return succeeded('Aborted stale rebase', true);
};

const readHeadSha = async (cwd: string): Promise<string | null> => {
	const result = await execGitAllowFail({args: ['rev-parse', 'HEAD'], cwd});
	return result.exitCode === 0 ? result.stdout.trim() : null;
};

/**
 * Network-level failures only. Our own timeout is deliberately not one: a slow
 * remote needs the user to act, so it reaches them as a failure.
 */
export const isRemoteUnreachable = (message: string): boolean =>
	/could not resolve host/i.test(message) ||
	/connection refused|connection timed out|operation timed out/i.test(
		message,
	) ||
	/network is unreachable|no route to host/i.test(message) ||
	/failed to connect to/i.test(message);

// git's wording when the branch does not exist on the remote.
const isMissingRemoteRef = (message: string): boolean =>
	message.includes("couldn't find remote ref") ||
	message.includes('Could not find remote branch');

export const pullBranchRebaseIfPresent = async ({
	cwd,
	branch,
}: {
	cwd: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const abortResult = await abortRebaseIfPresent(cwd);
	if (isFail(abortResult)) return failed(abortResult.message);

	const before = await readHeadSha(cwd);

	// Fetch then rebase, not `pull --rebase`, which reads the shared FETCH_HEAD.
	const fetchResult = await git.fetch({cwd, remote: ORIGIN, branch});

	if (isFail(fetchResult)) {
		if (isMissingRemoteRef(fetchResult.message)) {
			return succeeded('Remote branch missing, skipped pull', false);
		}

		return failed(`Failed to fetch ${branch}\n${fetchResult.message}`);
	}

	const rebaseResult = await rebaseWithRetry(cwd, `${ORIGIN}/${branch}`);

	if (isFail(rebaseResult)) {
		return failed(`Failed during rebase\n${rebaseResult.message}`);
	}

	const after = await readHeadSha(cwd);
	const moved = before !== null && after !== null && before !== after;

	return succeeded(moved ? 'Pulled with rebase' : 'Already up to date', moved);
};

/** No upstream counts as unpushed: the branch was never published. */
export const hasUnpushedCommits = async (
	cwd: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-list', '--count', '@{u}..HEAD'],
		cwd,
	});

	if (result.exitCode !== 0) {
		return succeeded('No upstream: never pushed', true);
	}

	return succeeded(
		'Compared against upstream',
		Number(result.stdout.trim()) > 0,
	);
};

/** Anything `--force` removal would lose, untracked included (a first event log is). */
export const hasUncommittedChanges = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['status', '--porcelain', '--untracked-files=all'],
		cwd: worktreeRoot,
	});

	if (result.exitCode !== 0) {
		return failed(
			result.stderr.trim() || 'Unable to inspect the worktree for changes',
		);
	}

	return succeeded(
		'Inspected worktree for changes',
		result.stdout.trim().length > 0,
	);
};

export const hasStagedChanges = async (
	repoRoot: string,
	pathspec?: string[],
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: [
			'diff',
			'--cached',
			'--quiet',
			...(pathspec?.length ? ['--', ...pathspec] : []),
		],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) {
		return succeeded('No staged changes', false);
	}

	if (result.exitCode === 1) {
		return succeeded('Has staged changes', true);
	}

	return failed(result.stderr.trim() || 'Unable to inspect staged changes');
};

export const hasStateBranchChanges = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['status', '--porcelain'],
		cwd: stateBranchRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded(
		'Checked state branch changes',
		result.value.stdout.trim().length > 0,
	);
};

export const isDetachedHead = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const branchResult = await getCurrentBranch(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	return succeeded(
		'Checked detached HEAD state',
		branchResult.value === 'HEAD',
	);
};
