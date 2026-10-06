import fs from 'node:fs';
import path from 'node:path';
import {execGit} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {resolveRepoRoot} from './commit-repo.js';
import {getRepoClonePath, readCommitRepos, sinceDate} from './commit-repos.js';

/**
 * Somewhere commits are read from. The board's own repo is one, read in place;
 * each registered repo is another, read from epiq's clone of it. Every read
 * goes through the same shape, so neither is a special case downstream.
 */
export type CommitSource = {
	/** The registered repo's id; absent for the board's own repo. */
	repo?: string;
	cwd: string;
	/** What `git log` walks. */
	revisions: string[];
	/** Commits to leave out of every list. */
	exclude: ReadonlySet<string>;
	/**
	 * Where the repo's history window opens, in ms; older commits are left out.
	 * A fetch can bring in more than the window — a branch new since the
	 * clone arrives with its whole history — and the window is what was asked.
	 */
	notBefore?: number;
};

const NOTHING: ReadonlySet<string> = new Set();

// Why a clone could not be read the last time it was, by repo id: a read that
// fails leaves the repo's commits out, and the panel says so rather than
// showing a repo that looks fetched and holds nothing.
const readProblems = new Map<string, string>();

export const noteCloneRead = (repoId: string, problem: string | null) => {
	if (problem) readProblems.set(repoId, problem);
	else readProblems.delete(repoId);
};

export const cloneReadProblem = (repoId: string): string | null =>
	readProblems.get(repoId) ?? null;

/**
 * A shallow clone's boundary commits have no parent here, so git diffs them
 * against nothing and reports the whole tree as added. They are where the
 * window was cut, not work anybody did in it.
 */
const shallowBoundary = (clonePath: string): ReadonlySet<string> => {
	try {
		return new Set(
			fs
				.readFileSync(path.join(clonePath, 'shallow'), 'utf8')
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean),
		);
	} catch {
		return NOTHING;
	}
};

export const listCommitSources = async (
	repoRoot?: string,
): Promise<Result<CommitSource[]>> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const root = repoRootResult.value;

	const projectResult = readProjectFile(root);
	if (isFail(projectResult)) return failed(projectResult.message);

	// `--not <stateBranch>` is required: worktrees share one ref namespace, so
	// epiq's own state commits would otherwise appear mixed into real
	// development history.
	const own: CommitSource = {
		cwd: root,
		revisions: ['--branches', '--not', projectResult.value.stateBranch],
		exclude: NOTHING,
	};

	const reposResult = readCommitRepos(root);
	if (isFail(reposResult)) return succeeded('Listed sources', [own]);

	const clones = reposResult.value.flatMap((repo): CommitSource[] => {
		const clonePath = getRepoClonePath(projectResult.value.projectId, repo.id);
		if (!fs.existsSync(clonePath)) return [];

		const since = sinceDate(repo.since, projectResult.value.createdAt);

		return [
			{
				repo: repo.id,
				cwd: clonePath,
				// A bare clone's HEAD is the remote's default branch.
				revisions: repo.branches === 'all' ? ['--branches'] : ['HEAD'],
				exclude: shallowBoundary(clonePath),
				...(since ? {notBefore: Date.parse(`${since}T00:00:00Z`)} : {}),
			},
		];
	});

	return succeeded('Listed sources', [own, ...clones]);
};

/** Where a repo's commits are read, by its id; the board's own repo has none. */
export const sourceCwdOf =
	(sources: CommitSource[]) =>
	(repo: string | undefined): string | undefined =>
		sources.find(source => (source.repo ?? '') === (repo ?? ''))?.cwd;

const hasCommit = async (cwd: string, sha: string): Promise<boolean> =>
	!isFail(
		await execGit({
			cwd,
			args: ['cat-file', '-e', `${sha}^{commit}`],
		}),
	);

/**
 * Where to read one commit from. A caller that knows the repo names it; one
 * that holds only a sha — an older client, a hand-typed MCP call, a TUI node —
 * gets the first source that has the commit, the board's own repo first.
 */
export const resolveCommitCwd = async (input: {
	repoRoot?: string;
	repo?: string;
	sha: string;
}): Promise<Result<string>> => {
	const sourcesResult = await listCommitSources(input.repoRoot);
	if (isFail(sourcesResult)) return failed(sourcesResult.message);
	const sources = sourcesResult.value;

	if (input.repo) {
		const named = sources.find(source => source.repo === input.repo);
		return named
			? succeeded('Resolved repo', named.cwd)
			: failed(`No clone of repo "${input.repo}" here yet — sync to fetch it`);
	}

	// One source is the common case, and it needs no probe.
	if (sources.length === 1) return succeeded('Resolved repo', sources[0]!.cwd);

	for (const source of sources) {
		if (await hasCommit(source.cwd, input.sha)) {
			return succeeded('Resolved repo', source.cwd);
		}
	}

	return succeeded('Resolved repo', sources[0]!.cwd);
};
