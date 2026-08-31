import {existsSync} from 'node:fs';
import {chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit, readGitBlobsBatch} from '../git/git-utils.js';
import {NODE_REF_LENGTH} from '../lib/utils/node-ref.js';
import {
	getEditorCandidates,
	isVSCodeEditor,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../lib/editor/editor.js';
import {getEventTime, toEffectiveUlidTimes} from '../lib/event/date-utils.js';
import {AppEvent, EventAction} from '../lib/event/event.model.js';
import {formatLogAction} from '../lib/event/format-log-utils.js';
import {getStringColor} from '../lib/utils/color.js';
import {
	loadEffectiveEventTimes,
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {
	logSkippedEvents,
	materializeAll,
	partitionMaterializeResults,
} from '../lib/event/event-materialize.js';
import {minOf} from '../lib/utils/minmax.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {ApiTimeTravelStatus} from './api-state.model.js';

type ToolInput = {repoRoot?: string};

// Free to set high: iteration is over events, not slots, and only non-empty
// buckets are returned, so more slots only means finer resolution.
const TIMELINE_BUCKET_COUNT = 100_000;

// Above this the per-event scatter is dropped and the client falls back to
// buckets. Well clear of a normal board — this repo's whole log is ~1.2k.
const TIMELINE_EVENT_CAP = 20_000;

// Not in AppState: purely GUI-server bookkeeping.
let currentAsOfTime: number | null = null;

// Serializes read-then-write of the shared state singleton across an `await`.
// NOT re-entrant: calling runExclusive from inside it deadlocks forever.
let opQueue: Promise<unknown> = Promise.resolve();

export const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
	const result = opQueue.then(fn, fn);
	opQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
};

const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

const resolveStateBranchRoot = (repoRoot?: string): Result<string> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	return getStateBranchRoot({repoRoot: repoRootResult.value});
};

export const getTimeTravelStatus = (): ApiTimeTravelStatus => {
	if (!isStateInitialized()) return {mode: 'live', asOfTime: null};

	const {timeMode} = getState();

	return timeMode === 'live'
		? {mode: 'live', asOfTime: null}
		: {mode: 'scrub', asOfTime: currentAsOfTime};
};

export type EventTimelineBucket = {t: number; count: number};

// Colour resolved here rather than on the client: getStringColor pulls in
// chalk, which the GUI bundle cannot take.
export type EventIdentity = {id: string; name: string; color: string};

export type EventTimelineEntry = {
	// The event's own id, so a client can match a dot to a ticket's log line.
	id: string;
	t: number;
	action: EventAction;
	// Phrased like a TUI log line — "Tagged with bug", "Commented".
	label: string;
	// Who performed the event. On a comment that is its author.
	actor: EventIdentity | null;
	// The tag or contributor the event is *about*, where it has one — the thing
	// the scatter colours a tagging or assigning dot by.
	tag: EventIdentity | null;
	assignee: EventIdentity | null;
};

// Tag and contributor names come from the log's own create events rather than
// from the materialized state, which getEventTimeline must not touch. Same
// technique as filterEventsForBoard: build the index as the scan proceeds.
const buildNameIndex = (events: AppEvent[]): Map<string, string> => {
	const names = new Map<string, string>();

	for (const event of events) {
		if (
			event.action !== 'create.tag' &&
			event.action !== 'create.contributor'
		) {
			continue;
		}

		const payload = event.payload as {id?: string; name?: string} | undefined;

		if (payload?.id && payload.name) names.set(payload.id, payload.name);
	}

	return names;
};

// Which tag an event is about. Tagging a ticket names it as `tag`; deleting or
// restoring the tag itself names it as the event's own `id`.
const tagOf = (event: AppEvent): string | undefined => {
	// Optional like filterEventsForBoard's: a malformed log entry must not take
	// the whole timeline down with it.
	const payload = event.payload as {id?: string; tag?: string} | undefined;

	return event.action === 'tombstone.tag' || event.action === 'restore.tag'
		? payload?.id
		: payload?.tag;
};

// The TUI's phrasing minus the details that need state. A renamed tag reads
// under its original name, which is what the log itself says happened.
const describeTimelineEvent = (
	event: AppEvent,
	names: Map<string, string>,
): string => {
	const payload = event.payload as
		| {name?: string; assignee?: string}
		| undefined;
	const tag = tagOf(event);

	const detail =
		tag !== undefined
			? names.get(tag) ?? ''
			: payload?.assignee !== undefined
			? names.get(payload.assignee) ?? ''
			: payload?.name !== undefined
			? `"${payload.name}"`
			: '';

	const action = event.action ? formatLogAction(event.action) : '';

	return [action, detail].filter(Boolean).join(' ');
};

// A referenced id with no create event in the log still gets an entry, under
// the id itself: dropping it would silently thin the filter's list.
const identityFor = (
	id: string | undefined,
	names: Map<string, string>,
): EventIdentity | null => {
	if (!id) return null;

	const name = names.get(id) ?? id;

	return {id, name, color: getStringColor(name)};
};

const identitiesFor = (
	event: AppEvent,
	names: Map<string, string>,
): Pick<EventTimelineEntry, 'actor' | 'tag' | 'assignee'> => {
	const payload = event.payload as {assignee?: string} | undefined;

	return {
		actor: event.userId
			? {
					id: event.userId,
					name: event.userName ?? event.userId,
					color: getStringColor(event.userName ?? event.userId),
			  }
			: null,
		tag: identityFor(tagOf(event), names),
		assignee: identityFor(payload?.assignee, names),
	};
};

export type EventTimeline = {
	bucketMs: number;
	buckets: EventTimelineBucket[];
	// One entry per event, for the scatter layout: it plots each dot at its own
	// timestamp, so bucketing there only merges events that happened to land in
	// the same slot. Empty past TIMELINE_EVENT_CAP, where the scatter falls back
	// to `buckets` rather than the payload growing without bound.
	events: EventTimelineEntry[];
	earliest: number;
	latest: number;
};

// The id -> parent map is built as the scan proceeds, so each event is
// attributed using the hierarchy as it stood then. No-board events are dropped.
export const filterEventsForBoard = (
	events: AppEvent[],
	boardId: string,
): AppEvent[] => {
	const parentById = new Map<string, string>();
	const boardIds = new Set<string>();

	const resolveBoard = (id: string): string | null => {
		const seen = new Set<string>();
		let current: string | undefined = id;

		while (current && !seen.has(current)) {
			if (boardIds.has(current)) return current;
			seen.add(current);
			current = parentById.get(current);
		}

		return null;
	};

	const matching: AppEvent[] = [];

	for (const event of events) {
		const payload = event.payload as {
			id?: string;
			parent?: string;
			issue?: string;
		};
		const id = payload?.id;
		if (!id) continue;

		// Before matching, so a board's own add event is attributed to it.
		if (event.action === 'add.board') {
			boardIds.add(id);
		}

		// Comments and attachments hang off `issue`: their `id` is the comment's
		// or attachment's own, so without this they resolve to no board at all
		// and drop out of every board-scoped view.
		const parent = payload.parent ?? payload.issue;

		if (parent) {
			parentById.set(id, parent);
		}

		if (id === boardId || resolveBoard(id) === boardId) {
			matching.push(event);
		}
	}

	return matching;
};

// Pure read: never touches the materialized state singleton, so it is safe
// mid-scrub. Omit `start`/`end` for an [earliest event, now] window.
export const getEventTimeline = async (
	input: ToolInput & {start?: number; end?: number; boardId?: string} = {},
): Promise<Result<EventTimeline>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult))
		return failed(stateBranchRootResult.message);

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const scopedEvents = input.boardId
		? filterEventsForBoard(eventsResult.value, input.boardId)
		: eventsResult.value;

	// Indexed over the unscoped log, and over all of it rather than the window.
	// Tags and contributors are global — their create events hang off no board,
	// so scoping first leaves every name unresolved and the timeline shows raw
	// ULIDs where it means "bug" or "jola".
	const names = buildNameIndex(eventsResult.value);

	// Effective times over the full log, not the board-scoped subset, so a
	// poisoned id's dot lands where the scrub/checkout path will cut.
	const effectiveTimes = toEffectiveUlidTimes(
		eventsResult.value.map(event => getEventTime(event)),
	);
	const timeByEventId = new Map(
		eventsResult.value.map((event, index) => [
			event.id,
			effectiveTimes[index] ?? null,
		]),
	);

	const timed = scopedEvents.flatMap(event => {
		const t = timeByEventId.get(event.id) ?? null;

		return t === null
			? []
			: [
					{
						id: event.id,
						t,
						action: event.action,
						label: describeTimelineEvent(event, names),
						...identitiesFor(event, names),
					},
			  ];
	});

	const now = Date.now();
	const windowEnd = input.end ?? now;
	// Folded, not spread: `timed` can hold one entry per event in the whole log.
	const windowStart =
		input.start ??
		minOf(
			timed.map(entry => entry.t),
			windowEnd,
		);

	if (windowEnd <= windowStart) {
		return succeeded('Empty time window', {
			bucketMs: 0,
			buckets: [],
			events: [],
			earliest: windowStart,
			latest: windowEnd,
		});
	}

	const inWindow = timed
		.filter(entry => entry.t >= windowStart && entry.t < windowEnd)
		.sort((a, b) => a.t - b.t);

	const times = inWindow.map(entry => entry.t);

	const bucketMs = Math.max(
		1,
		Math.ceil((windowEnd - windowStart) / TIMELINE_BUCKET_COUNT),
	);

	const countsByBucketStart = new Map<number, number>();

	for (const t of times) {
		const bucketIndex = Math.min(
			TIMELINE_BUCKET_COUNT - 1,
			Math.floor((t - windowStart) / bucketMs),
		);
		const bucketStart = windowStart + bucketIndex * bucketMs;

		countsByBucketStart.set(
			bucketStart,
			(countsByBucketStart.get(bucketStart) ?? 0) + 1,
		);
	}

	const buckets = [...countsByBucketStart.entries()]
		.sort(([a], [b]) => a - b)
		.map(([t, count]) => ({t, count}));

	return succeeded('Computed event timeline', {
		bucketMs,
		buckets,
		events: inWindow.length > TIMELINE_EVENT_CAP ? [] : inWindow,
		earliest: windowStart,
		latest: windowEnd,
	});
};

export type CommitEntry = {
	sha: string;
	time: number;
	author: string;
	subject: string;
	linesChanged: number;
	insertions: number;
	deletions: number;
};

// Non-printable, so a commit subject can never contain them.
const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_RECORD_SEP = '\x1e';

// The full (unwindowed) scan is the one both the scrubber ('All' scope) and
// getCommitsForRef ask for, typically moments apart over the same history —
// short-lived since nothing here invalidates it on a new commit landing, just
// long enough to cover "the Commits tab opens right after the scrubber loads".
export const FULL_TIMELINE_CACHE_TTL_MS = 5_000;

let fullTimelineCache: {
	repoRoot: string;
	stateBranch: string;
	fetchedAt: number;
	result: CommitEntry[];
} | null = null;

// Test-only: the cache is module-level state, so it would otherwise leak
// between `it()` blocks in the same file (unlike vi.clearAllMocks(), which
// only resets mock call state, not arbitrary module variables).
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache = null;
};

// Pure read of the *code* repo's history, safe mid-scrub. `--not <stateBranch>`
// is required: worktrees share one ref namespace, so epiq's own state commits
// would otherwise appear mixed into real development history.
export const getCommitTimeline = async (
	input: ToolInput & {start?: number; end?: number} = {},
): Promise<Result<CommitEntry[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const projectResult = readProjectFile(repoRootResult.value);
	if (isFail(projectResult)) return failed(projectResult.message);

	// Only the unwindowed call is cached — it is the expensive, frequently-
	// repeated one (a full `--shortstat` scan of the whole history); a
	// start/end-scoped scrub is comparatively cheap and varies request to
	// request, so caching it would mostly just grow a cache no one re-hits.
	const cacheable = input.start === undefined && input.end === undefined;

	if (
		cacheable &&
		fullTimelineCache &&
		fullTimelineCache.repoRoot === repoRootResult.value &&
		fullTimelineCache.stateBranch === projectResult.value.stateBranch &&
		Date.now() - fullTimelineCache.fetchedAt < FULL_TIMELINE_CACHE_TTL_MS
	) {
		return succeeded('Computed commit timeline', fullTimelineCache.result);
	}

	const logResult = await execGit({
		cwd: repoRootResult.value,
		args: [
			'log',
			'--branches',
			'--not',
			projectResult.value.stateBranch,
			...(input.start !== undefined
				? [`--since=@${Math.floor(input.start / 1000)}`]
				: []),
			...(input.end !== undefined
				? [`--until=@${Math.floor(input.end / 1000)}`]
				: []),
			'--shortstat',
			`--format=${GIT_LOG_RECORD_SEP}%H${GIT_LOG_FIELD_SEP}%at${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%s`,
		],
	});

	if (isFail(logResult)) return failed(logResult.message);

	const commits = logResult.value.stdout
		.split(GIT_LOG_RECORD_SEP)
		.filter(record => record.trim().length > 0)
		.map((record): CommitEntry | null => {
			const [headerLine, ...statLines] = record.split('\n');
			const [sha, atSeconds, author, ...subjectParts] = (
				headerLine ?? ''
			).split(GIT_LOG_FIELD_SEP);
			if (!sha || !atSeconds) return null;

			const statText = statLines.join(' ');
			const insertions = Number(/(\d+) insertion/.exec(statText)?.[1] ?? 0);
			const deletions = Number(/(\d+) deletion/.exec(statText)?.[1] ?? 0);

			return {
				sha,
				time: Number(atSeconds) * 1000,
				author: author ?? 'unknown',
				subject: subjectParts.join(GIT_LOG_FIELD_SEP),
				linesChanged: insertions + deletions,
				insertions,
				deletions,
			};
		})
		.filter((commit): commit is CommitEntry => commit !== null)
		// `--since`/`--until` match on the committer date, but a commit is plotted
		// at its author date, and a rebase moves the two days apart. Left in, such
		// a commit sits outside the window it was fetched for and stretches the
		// axis to reach it.
		.filter(
			commit =>
				(input.start === undefined || commit.time >= input.start) &&
				(input.end === undefined || commit.time <= input.end),
		);

	if (cacheable) {
		fullTimelineCache = {
			repoRoot: repoRootResult.value,
			stateBranch: projectResult.value.stateBranch,
			fetchedAt: Date.now(),
			result: commits,
		};
	}

	return succeeded('Computed commit timeline', commits);
};

// Matches the convention documented in the epiq skill: a commit's subject is
// prefixed with the issue's ref, e.g. "5S52AC8 message". Reuses
// getCommitTimeline's full-history read rather than a second git invocation —
// same repo, same state-branch exclusion, and this repo's whole history is a
// few thousand commits at most.
// A matched commit whose immediate predecessor in the *unfiltered* history
// (git log's very next entry, not just the next match) is also a matched
// commit — i.e. no other ticket's commit sits between them.
export type RefCommitEntry = CommitEntry & {precedingSha: string | null};

export const getCommitsForRef = async (
	input: ToolInput & {ref: string},
): Promise<Result<RefCommitEntry[]>> => {
	const ref = input.ref.trim();
	if (!ref) return failed('ref must not be empty');

	// Matching below is a strict `<REF> ` prefix, so a ref of the wrong length
	// can only ever return nothing — which reads identically to "this ticket
	// has no commits". A ref is NODE_REF_LENGTH characters by construction, so
	// any other length is a mistake worth naming rather than answering.
	if (ref.length !== NODE_REF_LENGTH) {
		return failed(
			`"${ref}" is ${ref.length} characters; a ref is ${NODE_REF_LENGTH}. ` +
				`Read it off the issue rather than slicing the id by hand.`,
		);
	}

	const timelineResult = await getCommitTimeline({repoRoot: input.repoRoot});
	if (isFail(timelineResult)) return failed(timelineResult.message);

	// Case-insensitive, matching nodeRefMatches' convention (source/lib/utils/node-ref.ts)
	// rather than a strict-case prefix: a hand-typed or manually-copied ref
	// should still match, not just one pasted verbatim from the MCP response.
	const prefix = `${ref.toUpperCase()} `;
	const matches = (commit: CommitEntry) =>
		commit.subject.toUpperCase().startsWith(prefix);

	// Newest-first, same order git log itself returns — so all[i + 1] is
	// exactly the commit immediately before all[i] in real history, matched
	// or not.
	const all = timelineResult.value;

	const matched: RefCommitEntry[] = [];

	for (const [index, commit] of all.entries()) {
		if (!matches(commit)) continue;

		const precedingCommit = all[index + 1];

		matched.push({
			...commit,
			precedingSha:
				precedingCommit && matches(precedingCommit)
					? precedingCommit.sha
					: null,
		});
	}

	return succeeded('Matched commits by ref', matched);
};

// `sha` reaches a `git show <sha>` argv slot, where a leading `-` would be read
// as a flag. Argument injection, not shell injection.
const isPlausibleSha = (sha: string): boolean => /^[0-9a-f]{7,40}$/i.test(sha);

// Fallback: editors highlight the +/- lines but not the code's own language.
const openCommitAsUnifiedDiff = async (
	repoRoot: string,
	sha: string,
): Promise<Result<true>> => {
	const showResult = await execGit({cwd: repoRoot, args: ['show', sha]});
	if (isFail(showResult)) return failed(showResult.message);

	const tmpDir = path.join(os.tmpdir(), 'epiq', 'commit-diffs');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, `${sha}.diff`);

	// Already chmod 0o444 after the first write, so re-writing would fail EACCES.
	if (!existsSync(tmpPath)) {
		fileManager.writeToFile(tmpPath, showResult.value.stdout);
		await chmod(tmpPath, 0o444);
	}

	return openEditorOnFileNonBlocking(tmpPath);
};

// Beyond this, dozens of tabs (one editor spawn each) is worse than one diff.
const MAX_DIFF_FILES_FOR_SIDE_BY_SIDE = 12;

// No CLI signal for "the new window is up", so just long enough to outlast it.
const NEW_WINDOW_SETTLE_MS = 800;

// A missing blob only means the file was added or deleted here, not a failure.
const readFileAtRevision = async (
	repoRoot: string,
	revision: string,
	filePath: string,
): Promise<string> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['show', `${revision}:${filePath}`],
	});

	return isFail(result) ? '' : result.value.stdout;
};

// Shared by the editor path below and by getCommitDiff's data path. A plain
// two-tree diff against the first parent (matching readFileAtRevision's own
// `sha~1` convention) rather than `diff-tree -r <sha>`: diff-tree's single-
// commit mode reports no files at all for a merge commit unless told
// otherwise, which read as "no changes" instead of the merge's real diff.
const getChangedFilePaths = async (
	repoRoot: string,
	sha: string,
): Promise<Result<string[]>> => {
	const filesResult = await execGit({
		cwd: repoRoot,
		args: ['diff', '--name-only', `${sha}~1`, sha],
	});
	if (isFail(filesResult)) return failed(filesResult.message);

	const filePaths = filesResult.value.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);

	if (filePaths.length === 0) {
		return failed('No changed files found for this commit');
	}

	return succeeded('Listed changed files', filePaths);
};

// Each side keeps its real filename so the editor detects the language.
const openCommitAsSideBySideDiffs = async (
	repoRoot: string,
	sha: string,
	editor: string,
): Promise<Result<true>> => {
	const filesResult = await getChangedFilePaths(repoRoot, sha);
	if (isFail(filesResult)) return failed(filesResult.message);

	const filePaths = filesResult.value;

	if (filePaths.length > MAX_DIFF_FILES_FOR_SIDE_BY_SIDE) {
		return failed(
			`Commit touches ${filePaths.length} files — too many for a side-by-side view`,
		);
	}

	const tmpDir = path.join(os.tmpdir(), 'epiq', 'commit-diffs', sha);

	const preparedFiles = await Promise.all(
		filePaths.map(async (filePath, index) => {
			const [beforeContent, afterContent] = await Promise.all([
				readFileAtRevision(repoRoot, `${sha}~1`, filePath),
				readFileAtRevision(repoRoot, sha, filePath),
			]);

			// Indexed so same-named files from different directories don't collide.
			const basename = path.basename(filePath);
			const beforePath = path.join(tmpDir, String(index), 'before', basename);
			const afterPath = path.join(tmpDir, String(index), 'after', basename);

			if (!existsSync(beforePath)) {
				fileManager.writeToFile(beforePath, beforeContent);
				await chmod(beforePath, 0o444);
			}

			if (!existsSync(afterPath)) {
				fileManager.writeToFile(afterPath, afterContent);
				await chmod(afterPath, 0o444);
			}

			return {beforePath, afterPath};
		}),
	);

	// Must be sequenced: the first tab forces a new window, and the rest reuse
	// whichever window is active — after the settle delay below, that new one.
	const [first, ...rest] = preparedFiles;
	if (!first) return failed('No changed files found for this commit');

	const firstResult = await openEditorDiffNonBlocking(
		editor,
		first.beforePath,
		first.afterPath,
		'new',
	);
	if (isFail(firstResult) || rest.length === 0) return firstResult;

	await new Promise(resolve => setTimeout(resolve, NEW_WINDOW_SETTLE_MS));

	const restResults = await Promise.all(
		rest.map(({beforePath, afterPath}) =>
			openEditorDiffNonBlocking(editor, beforePath, afterPath, 'reuse'),
		),
	);

	for (const result of restResults) {
		if (isFail(result)) {
			logger.error(
				`Failed to open an additional diff tab for ${sha}: ${result.message}`,
			);
		}
	}

	return firstResult;
};

// Never touches the materialized state singleton, so it is independent of any
// time-travel checkout.
export const openCommitDiffInEditor = async (
	input: ToolInput & {sha: string},
): Promise<Result<true>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const primaryEditor = getEditorCandidates()[0];

	if (primaryEditor && isVSCodeEditor(primaryEditor)) {
		const sideBySideResult = await openCommitAsSideBySideDiffs(
			repoRoot,
			input.sha,
			primaryEditor,
		);

		if (!isFail(sideBySideResult)) return sideBySideResult;

		logger.error(
			`Side-by-side diff failed for ${input.sha}, falling back to unified diff: ${sideBySideResult.message}`,
		);
	}

	return openCommitAsUnifiedDiff(repoRoot, input.sha);
};

export type CommitDiffFile = {
	path: string;
	before: string;
	after: string;
};

export type CommitDiff = {
	sha: string;
	files: CommitDiffFile[];
};

// Bounds payload size for a pathological commit (a vendored dep, a lockfile
// rewrite) rather than the editor-tab-count concern MAX_DIFF_FILES_FOR_SIDE_BY_SIDE
// exists for — a rendered accordion tolerates far more files than open windows do.
const MAX_DIFF_FILES_FOR_DATA = 200;

// All zeros (--abbrev=40 gives 40 hex chars) is git's own way of writing "no
// blob on this side" in --raw output — the file was added or deleted here.
const isZeroBlob = (hash: string): boolean => /^0+$/.test(hash);

// `:<oldmode> <newmode> <oldblob> <newblob> <status>[score]\t<path>` — with
// --no-renames every line is a plain add/modify/delete of one path, never a
// two-path rename/copy line, so a single trailing field is always correct.
const RAW_DIFF_LINE =
	/^:\d{6} \d{6} ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\t(.+)$/;

type ChangedFileBlobs = {
	path: string;
	// null means "no blob on this side" (the file was added or deleted here),
	// same convention getChangedFilePaths' callers already read a missing
	// blob as — not a git failure.
	beforeBlob: string | null;
	afterBlob: string | null;
};

// Blob hashes straight from git's own diff, rather than getChangedFilePaths'
// name-only listing: this is what lets getCommitDiff below read every
// changed file's content in one `git cat-file --batch` round trip instead of
// two `git show` spawns per file. `--abbrev=40` forces full hashes — unlike
// `--full-index` (documented for this but, at least as of Apple Git 2.39.5,
// a no-op outside of `-p` patch output), this reliably defeats the
// repo-size-dependent abbreviation `--raw` uses by default.
const getChangedFileBlobs = async (
	repoRoot: string,
	sha: string,
): Promise<Result<ChangedFileBlobs[]>> => {
	const diffResult = await execGit({
		cwd: repoRoot,
		args: ['diff', '--raw', '--no-renames', '--abbrev=40', `${sha}~1`, sha],
	});
	if (isFail(diffResult)) return failed(diffResult.message);

	const lines = diffResult.value.stdout.split('\n').filter(line => line !== '');

	// A line git's --raw format doesn't match is a sign the assumed format
	// itself is wrong for this git version/commit shape (already bit once
	// this session: --full-index turned out to be a no-op here) — surfacing
	// it as a failure beats silently under-reporting a commit's real files.
	const unparseable = lines.filter(line => !RAW_DIFF_LINE.test(line));
	if (unparseable.length > 0) {
		return failed(
			`Could not parse ${unparseable.length} line(s) of "git diff --raw" output, e.g. "${unparseable[0]}"`,
		);
	}

	const entries = lines.map((line): ChangedFileBlobs => {
		const match = RAW_DIFF_LINE.exec(line);
		const beforeBlob = match?.[1] ?? '';
		const afterBlob = match?.[2] ?? '';
		const path = match?.[3] ?? '';

		return {
			path,
			beforeBlob: isZeroBlob(beforeBlob) ? null : beforeBlob,
			afterBlob: isZeroBlob(afterBlob) ? null : afterBlob,
		};
	});

	if (entries.length === 0) {
		return failed('No changed files found for this commit');
	}

	return succeeded('Listed changed files with blob hashes', entries);
};

// The GUI diff panel's data source: reads every changed file's before/after
// content in one `git diff --raw` (blob hashes) plus one `git cat-file
// --batch` (content for all of them), rather than the O(files) `git show`
// spawns the editor path above uses — each spawn pays real process-start
// overhead regardless of how little it reads, which dominated wall time on
// any commit touching more than a couple of files. Never touches the
// materialized state singleton, so it is independent of any time-travel
// checkout.
export const getCommitDiff = async (
	input: ToolInput & {sha: string},
): Promise<Result<CommitDiff>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const entriesResult = await getChangedFileBlobs(repoRoot, input.sha);
	if (isFail(entriesResult)) return failed(entriesResult.message);

	const entries = entriesResult.value;

	if (entries.length > MAX_DIFF_FILES_FOR_DATA) {
		return failed(
			`Commit touches ${entries.length} files — too many to show as a diff`,
		);
	}

	const blobHashes = entries.flatMap(entry =>
		[entry.beforeBlob, entry.afterBlob].filter(
			(hash): hash is string => hash !== null,
		),
	);

	const blobsResult = await readGitBlobsBatch(blobHashes, repoRoot);
	if (isFail(blobsResult)) return failed(blobsResult.message);

	const blobs = blobsResult.value;

	const files: CommitDiffFile[] = entries.map(entry => ({
		path: entry.path,
		before: entry.beforeBlob ? blobs.get(entry.beforeBlob) ?? '' : '',
		after: entry.afterBlob ? blobs.get(entry.afterBlob) ?? '' : '',
	}));

	return succeeded('Loaded commit diff', {sha: input.sha, files});
};

// Takes NO lock: its callers already run inside `runExclusive`, which is not
// re-entrant, so taking it here would deadlock forever.
const restoreLiveState = (stateBranchRoot: string): Result<true> => {
	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const resetResult = resetState();
	if (isFail(resetResult)) return failed(resetResult.message);

	// Cleared here, not at the end: past the reset the singleton's flags already
	// say live, so no exit below may leave an as-of time claiming a checkout.
	currentAsOfTime = null;

	const materializeResults = materializeAll(eventsResult.value);
	const {fatal, skipped} = partitionMaterializeResults(materializeResults);

	if (fatal.length > 0) {
		return failed(fatal.map(x => x.message).join(', '));
	}
	logSkippedEvents(skipped);

	patchState({
		readOnly: false,
		// Cleared alongside the flag it explains, or a later time-travel refusal
		// quotes a stale unreadable-log reason.
		readOnlyReason: undefined,
		timeMode: 'live',
		unappliedEvents: [],
		replay: null,
	});

	return succeeded('Restored live state', true);
};

// For failure paths where `resetState()` has already emptied the singleton while
// its flags claim live — mutation guards would be wide open over a board that is
// not there. Degrade to a real live state instead of leaving a phantom checkout.
const recoverToLiveAfterFailure = (
	stateBranchRoot: string,
	originalMessage: string,
): Result<never> => {
	currentAsOfTime = null;

	const restoreResult = restoreLiveState(stateBranchRoot);

	// Original failure leads; the recovery failure trails it as context.
	if (isFail(restoreResult)) {
		return failed(
			`${originalMessage} (recovery to live also failed: ${restoreResult.message})`,
		);
	}

	return failed(originalMessage);
};

// Rewinds the shared state singleton to `targetTime`, read-only.
export const checkoutStateAt = (
	input: ToolInput & {targetTime: number},
): Promise<Result<{asOfTime: number}>> =>
	runExclusive(async () => {
		const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
		if (isFail(stateBranchRootResult)) {
			return failed(stateBranchRootResult.message);
		}

		const eventsBeforeResult = loadMergedEventsBefore(
			stateBranchRootResult.value,
			input.targetTime,
		);
		if (isFail(eventsBeforeResult)) return failed(eventsBeforeResult.message);

		const {appliedEvents, unappliedEvents} = eventsBeforeResult.value;

		const resetResult = resetState();
		if (isFail(resetResult)) return resetResult;

		const materializeResults = materializeAll(appliedEvents);
		const {fatal, skipped} = partitionMaterializeResults(materializeResults);

		// The reset above already emptied the singleton, so bailing out plainly
		// would leave the board gone while still reporting live.
		if (fatal.length > 0) {
			return recoverToLiveAfterFailure(
				stateBranchRootResult.value,
				fatal.map(x => x.message).join(', '),
			);
		}
		logSkippedEvents(skipped);

		patchState({
			readOnly: true,
			timeMode: 'peek',
			unappliedEvents,
			replay: null,
		});

		currentAsOfTime = input.targetTime;

		return succeeded('Checked out historical state', {
			asOfTime: input.targetTime,
		});
	});

// Rewinds to just after one event in the log, so the state the checkout shows
// is the state that event produced. The cut is exclusive, hence the +1.
//
// Resolved against effective times, not the raw ULID a Log row displays: a
// poisoned far-future id is judged by the clamped time `splitEventsAtTime` will
// cut on, so the checkout lands where the scrubber's dot for it sits.
export const checkoutStateAtEvent = async (
	input: ToolInput & {eventId: string},
): Promise<Result<{asOfTime: number}>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	// Deliberately outside `runExclusive`: `checkoutStateAt` takes that lock and
	// it is not re-entrant.
	const timesResult = loadEffectiveEventTimes(stateBranchRootResult.value);
	if (isFail(timesResult)) return failed(timesResult.message);

	const time = timesResult.value.get(input.eventId) ?? null;
	if (time === null) return failed('Event not found in the log');

	return checkoutStateAt({repoRoot: input.repoRoot, targetTime: time + 1});
};

export const returnToLive = (input: ToolInput = {}): Promise<Result<true>> =>
	runExclusive(async () => {
		const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
		if (isFail(stateBranchRootResult)) {
			return failed(stateBranchRootResult.message);
		}

		const restoreResult = restoreLiveState(stateBranchRootResult.value);
		if (isFail(restoreResult)) return failed(restoreResult.message);

		return succeeded('Returned to live state', true);
	});
