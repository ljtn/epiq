/**
 * Git exports these into the environment of its hooks. They override repository
 * discovery, so anything a hook starts — a test, a spawned TUI — runs git
 * against *that* repository however careful it is with `cwd`. A `git push` once
 * rewrote real branches and wrote `user.name=Test` into the shared config this
 * way, while every path involved looked innocent.
 *
 * Anything a test runs, directly or as a child process, has to clear them
 * first.
 */
export const GIT_HOOK_VARS = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_PREFIX',
	'GIT_CONFIG',
] as const;

/** Clears them from this process, and so from anything it spawns. */
export const stripGitHookEnv = (): void => {
	for (const name of GIT_HOOK_VARS) delete process.env[name];
};

/** Whichever of them a caller is about to hand to a child. */
export const gitHookVarsIn = (env: NodeJS.ProcessEnv | undefined): string[] =>
	env ? GIT_HOOK_VARS.filter(name => env[name]) : [];
