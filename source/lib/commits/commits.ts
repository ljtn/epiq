// The repository's commits, and what they changed — one front door, so a
// caller asks `lib/commits` rather than picking a file out of it.
//
// Every read here is a pure read of the *code* repo, independent of the board
// and of any time-travel checkout, which is what lets the TUI, the GUI server
// and the MCP tools all answer from the same code.

export {
	isPlausibleSha,
	resolveRepoRoot,
	resolveSourceRef,
	type RepoInput,
	type SourceInput,
} from './commit-repo.js';

export {listSourceSpecs, type SourceRef} from './sources/registry.js';

export {SELF_SOURCE_ID} from './sources/source-spec.js';

export {
	FULL_TIMELINE_CACHE_TTL_MS,
	getCommitTimeline,
	getCommitsForRef,
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
