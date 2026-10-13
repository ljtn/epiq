// The code's commits, and what they changed — one front door, so a caller asks
// `lib/commits` rather than picking a file out of it.
//
// Commits come from the board's own repo and from every repo connected to the
// board, read from epiq's clones of them. Every read here is a pure
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
	findCommitRepo,
	findConnectedRepo,
	isAllowedRepoUrl,
	isRepoLabel,
	isRepoSince,
	MAX_REPOS,
	planRepoChange,
	readCommitRepos,
	readConnectedRepos,
	removableNames,
	repoIdOf,
	repoLabelOfId,
	repoLabelsById,
	repoUrlProblem,
	REPO_RENAMED,
	REPO_UNCHANGED,
	type CommitRepo,
	type RepoBranches,
	type RepoChange,
	type RepoSince,
	type ResolvedRepos,
} from './commit-repos.js';

export {
	cancelRepoPreview,
	claimedBytesOf,
	connectCommitRepo,
	hostOfRepoUrl,
	STAGE_TTL_MS,
	type ConnectOutcome,
	type RepoPreview,
} from './commit-repo-preflight.js';

export {readOwnRepo, type OwnRepo} from './own-repo.js';

export {
	describeFetchFailures,
	fetchCommitRepos,
	disconnectCommitRepo,
	listRepoStates,
	removeRepoClone,
	type RepoFetchOutcome,
	type RepoState,
} from './commit-repo-fetch.js';

export {
	listCommitSources,
	sourceCwdOf,
	type CommitSource,
} from './commit-sources.js';

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
