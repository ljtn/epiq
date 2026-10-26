/**
 * Git exports these to its hooks, overriding repository discovery whatever the
 * `cwd`; anything a test runs must clear them.
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
