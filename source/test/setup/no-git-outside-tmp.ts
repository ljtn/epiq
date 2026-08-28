/**
 * A test run once rewrote the developer's branches and git identity: `main` was
 * moved onto a chain of test commits and `user.name=Test` was written into the
 * shared `.git/config`. `git-safety.test.ts` already claims epiq only ever
 * commits into a user's repository in one place — this enforces that claim for
 * every suite, at the only chokepoint they share.
 *
 * Any `git` a test runs must be aimed at a throwaway directory. A cwd that does
 * not exist is allowed: git cannot reach a real repository through it, and a
 * couple of tests deliberately pass missing paths.
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.realpathSync(os.tmpdir());

/**
 * Git exports these into its hooks. They override repository discovery, so a
 * test that runs git in a temp directory is silently redirected at the
 * developer's checkout — which is how a `git push` once rewrote real branches
 * and wrote `user.name=Test` into the shared config. A path guard cannot see
 * this: there is nothing wrong with the path.
 */
const GIT_HOOK_VARS = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_PREFIX',
	'GIT_CONFIG',
] as const;

for (const name of GIT_HOOK_VARS) delete process.env[name];

const isThrowaway = (dir: string): boolean => {
	let resolved: string;

	try {
		resolved = fs.realpathSync(path.resolve(dir));
	} catch {
		return true;
	}

	return resolved === tempRoot || resolved.startsWith(tempRoot + path.sep);
};

const isGit = (command: string): boolean =>
	command === 'git' || path.basename(command) === 'git';

const assertThrowaway = (
	command: string,
	options: {cwd?: string | URL} | undefined,
): void => {
	if (!isGit(command)) return;

	// Absent means `process.cwd()`, which under vitest is the checkout itself.
	const cwd = options?.cwd;
	const dir = cwd === undefined ? process.cwd() : String(cwd);

	// Inherited by a child even though this process cleared its own copy.
	const inherited = GIT_HOOK_VARS.filter(
		name => (options as {env?: NodeJS.ProcessEnv} | undefined)?.env?.[name],
	);

	if (inherited.length > 0) {
		throw new Error(
			`Refusing to run git with ${inherited.join(', ')} set.\n` +
				`These override repository discovery, so git would act on that ` +
				`repository rather than the directory under test.`,
		);
	}

	if (isThrowaway(dir)) return;

	throw new Error(
		`Refusing to run git outside a throwaway directory during tests.\n` +
			`  cwd: ${dir}\n` +
			`Tests must operate on a directory under ${tempRoot}. Running git ` +
			`against the checkout rewrites real branches, config and refs.`,
	);
};

for (const name of [
	'spawn',
	'spawnSync',
	'execFile',
	'execFileSync',
] as const) {
	const original = childProcess[name] as (...args: unknown[]) => unknown;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(childProcess as any)[name] = (...args: unknown[]) => {
		const [command, second, third] = args;

		// The options object is the 2nd argument without args, the 3rd with them.
		const options = (Array.isArray(second) ? third : second) as
			| {cwd?: string | URL}
			| undefined;

		assertThrowaway(String(command), options);

		return original(...args);
	};
}
