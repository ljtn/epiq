// The code's commits, and what they changed — one front door, so a caller asks
// `lib/commits` rather than picking a file out of it.
//
// Commits come from the board's own repo and from every repo registered in
// `project.json`, read from epiq's clones of them. Every read here is a pure
// read, independent of the board and of any time-travel checkout, which is
// what lets the TUI, the GUI server and the MCP tools all answer from the same
// code. Only `fetchCommitRepos` touches the network, and only sync calls it.

export {
	isPlausibleSha,
	resolveRepoRoot,
	type CommitInput,
	type RepoInput,
} from './commit-repo.js';

export {
	isAllowedRepoUrl,
	isRepoSince,
	readCommitRepos,
	removeCommitRepo,
	repoIdOf,
	upsertCommitRepo,
	type CommitRepo,
	type RepoBranches,
	type RepoSince,
} from './commit-repos.js';

export {
	describeFetchFailures,
	fetchCommitRepos,
	listRepoStates,
	removeRepoClone,
	type RepoFetchOutcome,
	type RepoState,
} from './commit-repo-fetch.js';

export {listCommitSources, type CommitSource} from './commit-sources.js';

export {
	FULL_TIMELINE_CACHE_TTL_MS,
	getCommitTimeline,
	getCommitsForRef,
	invalidateCommitTimelineCache,
	resetCommitTimelineCacheForTests,
	type CommitEntry,
	type RefCommitEntry,
} from './commit-timeline.js';

export {
	getCommitDiff,
	getCommitPatch,
	getSquashedDiffForRef,
	type CommitDiff,
	type CommitDiffFile,
	type SquashedDiff,
	type SquashedDiffFile,
} from './commit-diff.js';

export {
	commentedRows,
	isFileRow,
	parsePatch,
	patchLineCount,
	patchRows,
	renamedFrom,
	type PatchFile,
	type PatchLine,
	type PatchLineKind,
	type PatchRow,
} from './patch-parse.js';

export {openCommitDiffInEditor} from './commit-editor.js';
