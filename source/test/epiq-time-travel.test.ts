import {createHash} from 'node:crypto';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

vi.mock('../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(),
}));

vi.mock('../lib/storage/paths.js', () => ({
	resolveClosestEpiqProjectRoot: vi.fn(),
}));

vi.mock('../lib/event/event-load.js', () => ({
	loadEffectiveEventTimes: vi.fn(),
	loadMergedEvents: vi.fn(),
	loadMergedEventsBefore: vi.fn(),
	getLastUnreadableEvents: vi.fn(() => []),
}));

vi.mock('../lib/event/event-materialize.js', async () => ({
	...(await vi.importActual<typeof import('../lib/event/event-materialize.js')>(
		'../lib/event/event-materialize.js',
	)),
	materializeAll: vi.fn(),
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	isStateInitialized: vi.fn(),
	patchState: vi.fn(),
	resetState: vi.fn(),
}));

vi.mock('../git/git-utils.js', () => ({
	execGit: vi.fn(),
	readGitBlobsBatch: vi.fn(),
}));

vi.mock('../lib/project-setup/project-setup.js', () => ({
	readProjectFile: vi.fn(),
}));

vi.mock('../lib/editor/editor.js', () => ({
	getEditorCandidates: vi.fn(),
	isVSCodeEditor: vi.fn(),
	openEditorDiffNonBlocking: vi.fn(),
	openEditorOnFileNonBlocking: vi.fn(),
}));

vi.mock('../lib/storage/file-manager.js', () => ({
	fileManager: {
		mkDir: vi.fn(),
		writeToFile: vi.fn(),
	},
}));

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
	chmod: vi.fn(),
}));

import {existsSync} from 'node:fs';
import {chmod} from 'node:fs/promises';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit, readGitBlobsBatch} from '../git/git-utils.js';
import {
	getEditorCandidates,
	isVSCodeEditor,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../lib/editor/editor.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	loadEffectiveEventTimes,
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {
	failed,
	isFail,
	isSuccess,
	succeeded,
} from '../lib/model/result-types.js';
import {
	checkoutStateAt,
	checkoutStateAtEvent,
	FULL_TIMELINE_CACHE_TTL_MS,
	getCommitDiff,
	getCommitsForRef,
	getCommitTimeline,
	getEventTimeline,
	getTimeTravelStatus,
	openCommitDiffInEditor,
	resetCommitTimelineCacheForTests,
	returnToLive,
	runExclusive,
} from '../mcp/epiq-time-travel.js';

describe('epiq-time-travel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetCommitTimelineCacheForTests();

		// An ambient global in the real app, so it cannot be vi.mock'd.
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		vi.mocked(resolveClosestEpiqProjectRoot).mockReturnValue(
			succeeded('root', '/repo'),
		);

		vi.mocked(getStateBranchRoot).mockReturnValue(
			succeeded('branch', '/repo/.epiq'),
		);

		vi.mocked(resetState).mockReturnValue(succeeded('reset', ''));
		vi.mocked(materializeAll).mockReturnValue([]);

		vi.mocked(readProjectFile).mockReturnValue(
			succeeded('project', {stateBranch: '__epiq_state__'} as never),
		);

		// Non-VS-Code by default, so tests land on the unified-diff fallback.
		vi.mocked(getEditorCandidates).mockReturnValue(['some-editor']);
		vi.mocked(isVSCodeEditor).mockReturnValue(false);
	});

	describe('getTimeTravelStatus', () => {
		it('reports live when state is uninitialized', () => {
			vi.mocked(isStateInitialized).mockReturnValue(false);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports live when timeMode is live', () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports scrub with the checked-out time after a successful checkout', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			await checkoutStateAt({targetTime: 5000});

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'scrub', asOfTime: 5000});
		});
	});

	describe('getEventTimeline', () => {
		it('returns an empty timeline when there is no event history', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.buckets).toEqual([]);
		});

		it('buckets event timestamps decoded from their ULIDs', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{id: ulid(baseTime)},
				{id: ulid(baseTime)},
				{id: ulid(baseTime + 60_000)},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(baseTime);
			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(3);
		});

		it('emits one entry per event even where a bucket merges them', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{id: ulid(baseTime), action: 'add.issue'},
				{id: ulid(baseTime), action: 'add.issue.tag'},
				{id: ulid(baseTime + 60_000), action: 'close.issue'},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			// The first two share a millisecond, so any bucketing collapses them.
			expect(result.value.events).toHaveLength(3);
			expect(result.value.events.map(entry => entry.action)).toEqual([
				'add.issue',
				'add.issue.tag',
				'close.issue',
			]);
		});

		it('keeps a poisoned far-future event visible at the latest honest time', async () => {
			const baseTime = Date.now() - 60_000;
			const poisonedTime = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
			const events = [
				{id: ulid(baseTime), action: 'add.issue'},
				{id: ulid(baseTime + 10_000), action: 'close.issue'},
				{id: ulid(poisonedTime), action: 'add.issue.tag'},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			// The default window ends at now; the poisoned event must not fall
			// outside it, and must land at the set's latest honest time.
			expect(result.value.events).toHaveLength(3);
			const poisoned = result.value.events.find(
				entry => entry.action === 'add.issue.tag',
			);
			expect(poisoned?.t).toBe(baseTime + 10_000);
		});

		it('keeps comments, which hang off `issue` rather than `parent`', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'board-1', name: 'Default'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.issue',
					payload: {id: 'issue-1', parent: 'board-1', name: 'Ship v2'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'add.issue.comment',
					// `id` is the comment's own, the link is `issue`.
					payload: {id: 'comment-1', issue: 'issue-1', md: 'hi'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline({boardId: 'board-1'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.map(entry => entry.action)).toContain(
				'add.issue.comment',
			);
		});
		it('names the ticket each event happened to, and none for the rest', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'board-1', name: 'Default'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.swimlane',
					payload: {id: 'lane-1', parent: 'board-1', name: 'Backlog'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'add.issue',
					payload: {id: 'issue-1', parent: 'lane-1', name: 'Ship v2'},
				},
				{
					id: ulid(baseTime + 3_000),
					action: 'close.issue',
					payload: {id: 'issue-1', parent: 'lane-1', rank: 'a'},
				},
				{
					id: ulid(baseTime + 4_000),
					action: 'add.issue.comment',
					payload: {id: 'comment-1', issue: 'issue-1', md: 'hi'},
				},
				{
					id: ulid(baseTime + 5_000),
					action: 'add.field',
					payload: {id: 'field-1', parent: 'issue-1', name: 'points'},
				},
				{
					id: ulid(baseTime + 6_000),
					action: 'edit.title',
					payload: {id: 'field-1', name: 'story points'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline({boardId: 'board-1'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(
				result.value.events.map(entry => [entry.action, entry.issue]),
			).toEqual([
				// A board and a swimlane happened to no ticket, and the lane's
				// own id must not be mistaken for one.
				['add.board', null],
				['add.swimlane', null],
				['add.issue', 'issue-1'],
				['close.issue', 'issue-1'],
				// The comment's own id is `id`; the ticket it hangs off is `issue`.
				['add.issue.comment', 'issue-1'],
				// A field node, and an edit naming the field rather than the ticket:
				// both are found by walking up to the ticket they hang off.
				['add.field', 'issue-1'],
				['edit.title', 'issue-1'],
			]);
		});

		it('names a tag under a board scope, where create.tag itself is out of scope', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'board-1', name: 'Default'},
				},
				// Hangs off no board, so filterEventsForBoard drops it.
				{
					id: ulid(baseTime + 1_000),
					action: 'create.tag',
					payload: {id: 'tag-1', name: 'bug'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'add.issue',
					payload: {id: 'issue-1', parent: 'board-1', name: 'Ship v2'},
				},
				{
					id: ulid(baseTime + 3_000),
					action: 'add.issue.tag',
					payload: {id: 'issue-1', tag: 'tag-1'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline({boardId: 'board-1'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			const tagged = result.value.events.find(
				entry => entry.action === 'add.issue.tag',
			);

			// The id would be the giveaway that the name never resolved.
			expect(tagged?.tag?.name).toBe('bug');
			expect(tagged?.label).toBe('Tagged with bug');
		});

		it('labels entries with the TUI log phrasing', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.issue',
					payload: {id: 'i1', name: 'Ship v2'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.issue.comment',
					payload: {id: 'c1'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.map(entry => entry.label)).toEqual([
				'Created with title "Ship v2"',
				'Commented',
			]);
		});

		it('names a tag from the log rather than the materialized state', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'create.tag',
					payload: {id: 'tag-1', name: 'bug'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.issue.tag',
					payload: {id: 'i1', tag: 'tag-1'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.at(-1)?.label).toBe('Tagged with bug');
		});

		// Deleting or restoring names the tag as the event's own id, so the Tags
		// view can colour and untick those dots like any other tagging event.
		it('attributes a tag deletion and restore to the tag itself', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'create.tag',
					payload: {id: 'tag-1', name: 'bug'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'tombstone.tag',
					payload: {id: 'tag-1'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'restore.tag',
					payload: {id: 'tag-1', name: 'bug'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			const [, deleted, restored] = result.value.events;
			expect(deleted?.label).toBe('Deleted tag bug');
			expect(deleted?.tag?.id).toBe('tag-1');
			expect(restored?.label).toBe('Restored tag bug');
			expect(restored?.tag?.id).toBe('tag-1');
		});

		// "Moved issue" says neither which lane nor whether the lane changed, and
		// reordering inside one lane is the commoner of the two.
		it('says which lane a move went to', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.swimlane',
					payload: {id: 'lane-todo', name: 'Todo', parent: 'b1'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.swimlane',
					payload: {id: 'lane-done', name: 'Done', parent: 'b1'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'add.issue',
					payload: {id: 'i1', name: 'Ship v2', parent: 'lane-todo'},
				},
				{
					id: ulid(baseTime + 3_000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-done', rank: 'a'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.at(-1)?.label).toBe('Moved to Done');
		});

		// The ticket never left the lane, so "Moved to Todo" would read as a lane
		// change that did not happen.
		it('says a reorder inside one lane is within it', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.swimlane',
					payload: {id: 'lane-todo', name: 'Todo', parent: 'b1'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.issue',
					payload: {id: 'i1', name: 'Ship v2', parent: 'lane-todo'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-todo', rank: 'b'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.at(-1)?.label).toBe('Moved within Todo');
		});

		// Where the ticket sat before a move is routinely outside the window being
		// drawn, so the index has to be built over the whole log — otherwise every
		// move at the start of a window reads as a lane change.
		it('reads the lane a move came from even when it is outside the window', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.swimlane',
					payload: {id: 'lane-todo', name: 'Todo', parent: 'b1'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'add.issue',
					payload: {id: 'i1', name: 'Ship v2', parent: 'lane-todo'},
				},
				{
					id: ulid(baseTime + 2_000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-todo', rank: 'b'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			// A window holding the move alone, not the creation that seeded it.
			const result = await getEventTimeline({
				start: baseTime + 1_500,
				end: baseTime + 3_000,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.map(entry => entry.label)).toEqual([
				'Moved within Todo',
			]);
		});

		// A lane with no create event in the log has no name to give, and a raw
		// ULID reads worse than saying less.
		it('falls back to the bare action for a lane it cannot name', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{
					id: ulid(baseTime),
					action: 'add.issue',
					payload: {id: 'i1', name: 'Ship v2', parent: 'lane-todo'},
				},
				{
					id: ulid(baseTime + 1_000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-unknown', rank: 'a'},
				},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.at(-1)?.label).toBe('Moved issue');
		});

		it('sorts the entries by time regardless of log order', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{id: ulid(baseTime + 60_000), action: 'close.issue'},
				{id: ulid(baseTime), action: 'add.issue'},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events.map(entry => entry.t)).toEqual([
				baseTime,
				baseTime + 60_000,
			]);
		});

		it('drops the per-event entries past the cap, keeping the buckets', async () => {
			const baseTime = 1_700_000_000_000;
			// One past TIMELINE_EVENT_CAP.
			const events = Array.from({length: 20_001}, (_, index) => ({
				id: ulid(baseTime + index * 1_000),
				action: 'add.issue',
			}));

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.events).toEqual([]);
			expect(result.value.buckets.length).toBeGreaterThan(0);
		});

		it('scopes to an explicit start/end window, excluding events outside it', async () => {
			const baseTime = 1_700_000_000_000;
			const dayMs = 24 * 60 * 60 * 1000;
			const events = [
				{id: ulid(baseTime - dayMs)}, // before the window
				{id: ulid(baseTime + dayMs)}, // inside the window
				{id: ulid(baseTime + 10 * dayMs)}, // after the window
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const windowStart = baseTime;
			const windowEnd = baseTime + 3 * dayMs;

			const result = await getEventTimeline({
				start: windowStart,
				end: windowEnd,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(windowStart);
			expect(result.value.latest).toBe(windowEnd);

			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(1);
		});

		it('propagates a failure to load events', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(failed('boom'));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(false);
		});
	});

	describe('getCommitTimeline', () => {
		const SEP = '\x1f';
		const REC = '\x1e';

		it('parses git log --shortstat output into commit entries with linesChanged', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}fix bug\n` +
						` 2 files changed, 45 insertions(+), 12 deletions(-)\n` +
						`${REC}bbb222${SEP}1700000100${SEP}Grace${SEP}add feature\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value).toEqual([
				{
					sha: 'aaa111',
					time: 1_700_000_000_000,
					author: 'Ada',
					subject: 'fix bug',
					linesChanged: 57,
					insertions: 45,
					deletions: 12,
				},
				{
					sha: 'bbb222',
					time: 1_700_000_100_000,
					author: 'Grace',
					subject: 'add feature',
					linesChanged: 0,
					insertions: 0,
					deletions: 0,
				},
			]);
		});

		it('excludes the epiq state branch via --not <stateBranch>', async () => {
			vi.mocked(readProjectFile).mockReturnValue(
				succeeded('project', {stateBranch: '__custom_state__'} as never),
			);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline();

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({
					args: expect.arrayContaining(['--not', '__custom_state__']),
				}),
			);
		});

		it('clips the log window to the given start/end via --since/--until', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline({
				start: 1_700_000_000_000,
				end: 1_700_000_100_000,
			});

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({
					args: expect.arrayContaining([
						'--since=@1700000000',
						'--until=@1700000100',
					]),
				}),
			);
		});

		// A rebase rewrites the committer date but keeps the author date, so
		// `--since` can match a commit that is plotted days outside the window.
		it('drops commits whose author date falls outside the window', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}aaa111${SEP}1700000050${SEP}Ada${SEP}inside the window\n` +
						`${REC}bbb222${SEP}1600000000${SEP}Grace${SEP}rebased from long ago\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitTimeline({
				start: 1_700_000_000_000,
				end: 1_700_000_100_000,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.map(commit => commit.sha)).toEqual(['aaa111']);
		});

		it('skips malformed lines missing a sha or timestamp', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout: `\n${SEP}${SEP}nobody${SEP}no sha or time\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value).toEqual([]);
		});

		it('propagates a git log failure', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('git not found'));

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(false);
		});

		it('reuses the unwindowed scan instead of re-invoking git log within the TTL', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout: `${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}fix bug\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const first = await getCommitTimeline();
			const second = await getCommitTimeline();

			expect(execGit).toHaveBeenCalledTimes(1);
			expect(second).toEqual(first);
		});

		it('does not cache a windowed (start/end) call', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline({start: 1, end: 2});
			await getCommitTimeline({start: 1, end: 2});

			expect(execGit).toHaveBeenCalledTimes(2);
		});

		it('does not let a windowed call warm the cache for a later unwindowed one', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline({start: 1, end: 2});
			await getCommitTimeline();

			expect(execGit).toHaveBeenCalledTimes(2);
		});

		it('does not fail a repeated call out of a cached failure', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('git not found'));

			await getCommitTimeline();

			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			const second = await getCommitTimeline();

			expect(execGit).toHaveBeenCalledTimes(2);
			expect(isSuccess(second)).toBe(true);
		});

		it('re-scans once the cached entry is older than the TTL', async () => {
			vi.useFakeTimers();

			try {
				vi.mocked(execGit).mockResolvedValue(
					succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
				);

				await getCommitTimeline();
				vi.advanceTimersByTime(FULL_TIMELINE_CACHE_TTL_MS + 1);
				await getCommitTimeline();

				expect(execGit).toHaveBeenCalledTimes(2);
			} finally {
				vi.useRealTimers();
			}
		});

		it('does not share the cache across a different repo root', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline();

			vi.mocked(resolveClosestEpiqProjectRoot).mockReturnValue(
				succeeded('root', '/other-repo'),
			);
			await getCommitTimeline();

			expect(execGit).toHaveBeenCalledTimes(2);
		});
	});

	describe('getCommitsForRef', () => {
		const SEP = '\x1f';
		const REC = '\x1e';

		it('matches commits whose subject starts with "<ref> "', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}5S52AC8 add the tool\n` +
						`${REC}bbb222${SEP}1700000100${SEP}Grace${SEP}unrelated commit\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitsForRef({ref: '5S52AC8'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value.map(commit => commit.sha)).toEqual(['aaa111']);
		});

		it('requires a space after the ref, not just a text prefix', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout: `${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}5S52AC89 similar but longer ref\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitsForRef({ref: '5S52AC8'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value).toEqual([]);
		});

		it('marks two matched commits as chained when nothing sits between them', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}newer111${SEP}1700000100${SEP}Ada${SEP}5S52AC8 second\n` +
						`${REC}older111${SEP}1700000000${SEP}Ada${SEP}5S52AC8 first\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitsForRef({ref: '5S52AC8'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(
				result.value.map(commit => [commit.sha, commit.precedingSha]),
			).toEqual([
				['newer111', 'older111'],
				['older111', null],
			]);
		});

		it('leaves precedingSha null when an unrelated commit breaks the chain', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}newer111${SEP}1700000200${SEP}Ada${SEP}5S52AC8 second\n` +
						`${REC}between${SEP}1700000100${SEP}Grace${SEP}unrelated commit\n` +
						`${REC}older111${SEP}1700000000${SEP}Ada${SEP}5S52AC8 first\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitsForRef({ref: '5S52AC8'});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(
				result.value.map(commit => [commit.sha, commit.precedingSha]),
			).toEqual([
				['newer111', null],
				['older111', null],
			]);
		});

		it('fails for an empty ref', async () => {
			const result = await getCommitsForRef({ref: '   '});

			expect(isSuccess(result)).toBe(false);
			expect(execGit).not.toHaveBeenCalled();
		});

		it('propagates a git log failure', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('git not found'));

			const result = await getCommitsForRef({ref: '5S52AC8'});

			expect(isSuccess(result)).toBe(false);
		});

		// The scrubber's own 'commits:get' (unwindowed, same as this) typically
		// fires moments before a ticket's Commits tab does — this is the specific
		// duplicate scan the timeline cache exists to collapse into one git call.
		it('reuses a timeline already scanned for a different ref instead of re-scanning', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}5S52AC8 add the tool\n` +
						`${REC}bbb222${SEP}1700000100${SEP}Grace${SEP}QG9544B add the tab\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const first = await getCommitsForRef({ref: '5S52AC8'});
			const second = await getCommitsForRef({ref: 'QG9544B'});

			expect(execGit).toHaveBeenCalledTimes(1);
			expect(isSuccess(first) && first.value.map(c => c.sha)).toEqual([
				'aaa111',
			]);
			expect(isSuccess(second) && second.value.map(c => c.sha)).toEqual([
				'bbb222',
			]);
		});
	});

	describe('openCommitDiffInEditor', () => {
		const validSha = 'b42a0bf111e4b6213abf6c1bfe65088b5c9764f8';

		beforeEach(() => {
			vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
				succeeded('Opened editor', true),
			);
		});

		it('rejects a sha shaped like a git flag, without ever shelling out', async () => {
			const result = await openCommitDiffInEditor({
				sha: '--upload-pack=/bin/sh',
			});

			expect(isSuccess(result)).toBe(false);
			expect(execGit).not.toHaveBeenCalled();
		});

		it('writes the diff to a sha-named temp file and opens it in the editor', async () => {
			vi.mocked(existsSync).mockReturnValue(false);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git show', {
					stdout: 'diff --git a/x b/x',
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await openCommitDiffInEditor({sha: validSha});

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({args: ['show', validSha]}),
			);

			expect(fileManager.writeToFile).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
				'diff --git a/x b/x',
			);
			expect(chmod).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
				0o444,
			);
			expect(openEditorOnFileNonBlocking).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
			);

			expect(isSuccess(result)).toBe(true);
		});

		it('reuses an already-written diff file instead of re-writing it', async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git show', {stdout: 'irrelevant', stderr: '', exitCode: 0}),
			);

			await openCommitDiffInEditor({sha: validSha});

			expect(fileManager.writeToFile).not.toHaveBeenCalled();
			expect(chmod).not.toHaveBeenCalled();
			expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
		});

		it('propagates a git show failure without touching the filesystem or editor', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('bad object'));

			const result = await openCommitDiffInEditor({sha: validSha});

			expect(isSuccess(result)).toBe(false);
			expect(fileManager.writeToFile).not.toHaveBeenCalled();
			expect(openEditorOnFileNonBlocking).not.toHaveBeenCalled();
		});

		describe('when the resolved editor is VS Code', () => {
			beforeEach(() => {
				vi.mocked(getEditorCandidates).mockReturnValue(['code']);
				vi.mocked(isVSCodeEditor).mockReturnValue(true);
				vi.mocked(existsSync).mockReturnValue(false);
				vi.mocked(openEditorDiffNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);
			});

			const mockGitForFiles = (
				files: string[],
				contentByPath: Record<string, string> = {},
			) => {
				vi.mocked(execGit).mockImplementation(async ({args}) => {
					if (args[0] === 'diff') {
						return succeeded('changed files', {
							stdout: files.join('\n'),
							stderr: '',
							exitCode: 0,
						});
					}

					if (args[0] === 'show') {
						const spec = args[1] ?? '';

						if (!spec.includes(':')) {
							return succeeded('git show', {
								stdout: 'unified diff fallback content',
								stderr: '',
								exitCode: 0,
							});
						}

						// Omit a spec to simulate a blob missing on that side.
						const content = contentByPath[spec];

						return content === undefined
							? failed('bad object (missing blob)')
							: succeeded('blob', {stdout: content, stderr: '', exitCode: 0});
					}

					return failed(`unexpected git args: ${args.join(' ')}`);
				});
			};

			it('opens one side-by-side diff per changed file, preserving each basename', async () => {
				mockGitForFiles(['source/gui/client/App.tsx', 'source/logger.ts'], {
					[`${validSha}:source/gui/client/App.tsx`]: 'after-app',
					[`${validSha}:source/logger.ts`]: 'after-logger',
				});

				// Fake timers skip the settle delay before the 2nd+ file opens.
				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				const result = await pending;
				vi.useRealTimers();

				expect(isSuccess(result)).toBe(true);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledTimes(2);
				expect(openEditorOnFileNonBlocking).not.toHaveBeenCalled();

				const calledPaths = vi
					.mocked(openEditorDiffNonBlocking)
					.mock.calls.map(([, before, after]) => ({before, after}));

				expect(
					calledPaths.some(
						({before, after}) =>
							before.endsWith('/before/App.tsx') &&
							after.endsWith('/after/App.tsx'),
					),
				).toBe(true);
				expect(
					calledPaths.some(
						({before, after}) =>
							before.endsWith('/before/logger.ts') &&
							after.endsWith('/after/logger.ts'),
					),
				).toBe(true);
			});

			it('opens the first file in a new window and the rest reused into it', async () => {
				mockGitForFiles(['source/a.ts', 'source/b.ts', 'source/c.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
					[`${validSha}:source/b.ts`]: 'b',
					[`${validSha}:source/c.ts`]: 'c',
				});

				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				await pending;
				vi.useRealTimers();

				const windowModes = vi
					.mocked(openEditorDiffNonBlocking)
					.mock.calls.map(([, , , windowMode]) => windowMode);

				expect(windowModes.filter(mode => mode === 'new')).toHaveLength(1);
				expect(windowModes.filter(mode => mode === 'reuse')).toHaveLength(2);
			});

			it('stays a success even if a later file fails to join the new window', async () => {
				mockGitForFiles(['source/a.ts', 'source/b.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
					[`${validSha}:source/b.ts`]: 'b',
				});
				vi.mocked(openEditorDiffNonBlocking).mockImplementation(
					async (_editor, _before, _after, windowMode) =>
						windowMode === 'new'
							? succeeded('Opened editor', true)
							: failed('"code" exited with code 1'),
				);

				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				const result = await pending;
				vi.useRealTimers();

				expect(isSuccess(result)).toBe(true);
			});

			it("doesn't wait for the settle delay when the commit touches only one file", async () => {
				mockGitForFiles(['source/a.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
				});

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(isSuccess(result)).toBe(true);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledTimes(1);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledWith(
					'code',
					expect.any(String),
					expect.any(String),
					'new',
				);
			});

			it('treats a missing blob (file added or deleted at this commit) as empty content, not a failure', async () => {
				mockGitForFiles(['source/new-file.ts'], {
					// No "before" spec: the file did not exist at this commit.
					[`${validSha}:source/new-file.ts`]: 'brand new content',
				});

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(isSuccess(result)).toBe(true);
				expect(fileManager.writeToFile).toHaveBeenCalledWith(
					expect.stringContaining('/before/new-file.ts'),
					'',
				);
				expect(fileManager.writeToFile).toHaveBeenCalledWith(
					expect.stringContaining('/after/new-file.ts'),
					'brand new content',
				);
			});

			it('falls back to the unified diff when the commit touches too many files', async () => {
				const manyFiles = Array.from(
					{length: 13},
					(_, i) => `source/file-${i}.ts`,
				);
				mockGitForFiles(manyFiles);
				vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);

				await openCommitDiffInEditor({sha: validSha});

				expect(openEditorDiffNonBlocking).not.toHaveBeenCalled();
				expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
			});

			it('falls back to the unified diff when every side-by-side open fails', async () => {
				mockGitForFiles(['source/x.ts'], {
					[`${validSha}:source/x.ts`]: 'content',
				});
				vi.mocked(openEditorDiffNonBlocking).mockResolvedValue(
					failed('"code" exited with code 1'),
				);
				vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
				expect(isSuccess(result)).toBe(true);
			});
		});
	});

	describe('getCommitDiff', () => {
		const validSha = 'b42a0bf111e4b6213abf6c1bfe65088b5c9764f8';
		const ZERO_BLOB = '0'.repeat(40);

		// Deterministic 40-hex-char stand-ins for real blob hashes, so the same
		// label always maps to the same fake hash across a test's mocks.
		const blobHash = (label: string): string =>
			createHash('sha1').update(label).digest('hex');

		// entries with `before`/`after` left undefined simulate that side having
		// no blob (the file was added or deleted at this commit) — the zero hash
		// getChangedFileBlobs reads as "no blob on this side", same convention
		// its caller already keys off.
		const mockGitForFiles = (
			entries: {path: string; before?: string; after?: string}[],
		) => {
			const blobs = new Map<string, string>();

			for (const entry of entries) {
				if (entry.before !== undefined) {
					blobs.set(blobHash(`before:${entry.path}`), entry.before);
				}
				if (entry.after !== undefined) {
					blobs.set(blobHash(`after:${entry.path}`), entry.after);
				}
			}

			vi.mocked(execGit).mockImplementation(async ({args}) => {
				if (args[0] === 'diff') {
					const stdout = entries
						.map(entry => {
							const beforeBlob =
								entry.before !== undefined
									? blobHash(`before:${entry.path}`)
									: ZERO_BLOB;
							const afterBlob =
								entry.after !== undefined
									? blobHash(`after:${entry.path}`)
									: ZERO_BLOB;

							return `:100644 100644 ${beforeBlob} ${afterBlob} M\t${entry.path}`;
						})
						.join('\n');

					return succeeded('changed files', {stdout, stderr: '', exitCode: 0});
				}

				return failed(`unexpected git args: ${args.join(' ')}`);
			});

			vi.mocked(readGitBlobsBatch).mockImplementation(async hashes =>
				succeeded(
					'blobs',
					new Map(hashes.map(hash => [hash, blobs.get(hash) ?? ''])),
				),
			);
		};

		it('rejects a sha shaped like a git flag, without ever shelling out', async () => {
			const result = await getCommitDiff({sha: '--upload-pack=/bin/sh'});

			expect(isSuccess(result)).toBe(false);
			expect(execGit).not.toHaveBeenCalled();
		});

		it('returns before/after content for each changed file', async () => {
			mockGitForFiles([
				{path: 'source/a.ts', before: 'a before', after: 'a after'},
				{path: 'source/b.ts', before: 'b before', after: 'b after'},
			]);

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(true);
			if (isSuccess(result)) {
				expect(result.value).toEqual({
					sha: validSha,
					files: [
						{path: 'source/a.ts', before: 'a before', after: 'a after'},
						{path: 'source/b.ts', before: 'b before', after: 'b after'},
					],
				});
			}
		});

		it('treats a missing blob (file added or deleted here) as empty content, not a failure', async () => {
			mockGitForFiles([
				{path: 'source/new-file.ts', after: 'brand new content'},
			]);

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(true);
			if (isSuccess(result)) {
				expect(result.value.files).toEqual([
					{
						path: 'source/new-file.ts',
						before: '',
						after: 'brand new content',
					},
				]);
			}
		});

		it('fetches every changed file in one blob-batch call, not one per file', async () => {
			mockGitForFiles([
				{path: 'source/a.ts', before: 'a before', after: 'a after'},
				{path: 'source/b.ts', before: 'b before', after: 'b after'},
			]);

			await getCommitDiff({sha: validSha});

			expect(readGitBlobsBatch).toHaveBeenCalledTimes(1);
			expect(execGit).toHaveBeenCalledTimes(1);
		});

		it('fails when the commit has no changed files', async () => {
			mockGitForFiles([]);

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(false);
		});

		it('fails when the commit touches too many files to render', async () => {
			const manyFiles = Array.from({length: 201}, (_, i) => ({
				path: `source/file-${i}.ts`,
				before: 'before',
				after: 'after',
			}));
			mockGitForFiles(manyFiles);

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(false);
			expect(readGitBlobsBatch).not.toHaveBeenCalled();
		});

		it('propagates a diff failure', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('bad object'));

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(false);
		});

		it('propagates a blob-batch read failure', async () => {
			mockGitForFiles([
				{path: 'source/a.ts', before: 'before', after: 'after'},
			]);
			vi.mocked(readGitBlobsBatch).mockResolvedValue(failed('cat-file failed'));

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(false);
		});

		// Regression guard against a git-version quirk biting silently: --raw's
		// line shape is assumed, not just hoped for (a real assumption already
		// broke once this session — --full-index turned out to be a no-op on
		// one git version). A line that doesn't parse should fail loudly rather
		// than quietly under-report the commit's real files.
		it('fails rather than silently dropping a diff --raw line it cannot parse', async () => {
			vi.mocked(execGit).mockImplementation(async ({args}) => {
				if (args[0] === 'diff') {
					return succeeded('changed files', {
						stdout: 'not a real diff --raw line',
						stderr: '',
						exitCode: 0,
					});
				}
				return failed(`unexpected git args: ${args.join(' ')}`);
			});

			const result = await getCommitDiff({sha: validSha});

			expect(isSuccess(result)).toBe(false);
			if (isFail(result)) {
				expect(result.message).toContain('not a real diff --raw line');
			}
			expect(readGitBlobsBatch).not.toHaveBeenCalled();
		});

		// diff-tree's single-commit mode reports no files for a merge commit
		// unless told otherwise — diffing against the first parent explicitly
		// (`sha~1`) works for both merge and non-merge commits alike.
		it('lists a merge commit as a diff against its first parent, not as having no changes', async () => {
			mockGitForFiles([
				{path: 'source/a.ts', before: 'before', after: 'after'},
			]);

			const result = await getCommitDiff({sha: validSha});

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({
					args: [
						'diff',
						'--raw',
						'--no-renames',
						'--abbrev=40',
						`${validSha}~1`,
						validSha,
					],
				}),
			);
			expect(isSuccess(result)).toBe(true);
			if (isSuccess(result)) {
				expect(result.value.files).toEqual([
					{path: 'source/a.ts', before: 'before', after: 'after'},
				]);
			}
		});
	});

	describe('checkoutStateAt', () => {
		it('materializes events before the target time and marks state read-only', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 1234);
			expect(resetState).toHaveBeenCalled();
			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: true,
				timeMode: 'peek',
				unappliedEvents: [{id: '2'}],
				replay: null,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value.asOfTime).toBe(1234);
		});

		it('fails without checking out a historical state when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(patchState).not.toHaveBeenCalledWith(
				expect.objectContaining({timeMode: 'peek'}),
			);
		});

		// resetState runs before materializing, so a failure must degrade to
		// "live" rather than leave an empty board that reads as writable.
		it('re-materializes the live head and marks state live when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [{id: 'new'}],
				} as never),
			);
			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: 'old'}, {id: 'new'}] as never),
			);

			// Only the historical slice fails; the head still materializes.
			vi.mocked(materializeAll).mockImplementation(events =>
				events.length === 1 ? [failed('boom')] : [],
			);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(materializeAll).toHaveBeenCalledWith([{id: 'old'}, {id: 'new'}]);
			expect(patchState).toHaveBeenCalledWith({
				readOnly: false,
				timeMode: 'live',
				unappliedEvents: [],
				replay: null,
			});
		});

		it('clears the tracked as-of time when materialization fails', async () => {
			// Sets the as-of clock, which the failing checkout must clear.
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 777});

			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));
			vi.mocked(materializeAll).mockImplementation(events =>
				events.length === 1 ? [failed('boom')] : [],
			);
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [],
				} as never),
			);

			await checkoutStateAt({targetTime: 1234});

			// The clock is only observable down the non-live branch.
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus().asOfTime).toBeNull();
		});

		it('reports the original failure first when the recovery to live also fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [],
				} as never),
			);
			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);
			vi.mocked(loadMergedEvents).mockReturnValue(failed('log unreadable'));

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(result.message).toContain('boom');
			expect(result.message).toContain('log unreadable');
			expect(result.message.indexOf('boom')).toBeLessThan(
				result.message.indexOf('log unreadable'),
			);
		});
	});

	describe('checkoutStateAtEvent', () => {
		beforeEach(() => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'a'}],
					unappliedEvents: [{id: 'b'}],
				} as never),
			);
		});

		// The cut is exclusive, so checking out *at* the event's own time would
		// show the state before it — the description it replaced, not the one it
		// wrote.
		it('cuts one millisecond after the named event, so that event is applied', async () => {
			vi.mocked(loadEffectiveEventTimes).mockReturnValue(
				succeeded('times', new Map([['evt-1', 5000]])),
			);

			const result = await checkoutStateAtEvent({eventId: 'evt-1'});

			expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 5001);
			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value.asOfTime).toBe(5001);
		});

		// The Log row displays the raw ULID time; the split judges by the
		// effective one. Resolving here rather than on the client is what keeps a
		// poisoned far-future id from checking out the whole log.
		it('resolves the effective time rather than trusting a displayed one', async () => {
			vi.mocked(loadEffectiveEventTimes).mockReturnValue(
				succeeded('times', new Map([['poisoned', 1000]])),
			);

			await checkoutStateAtEvent({eventId: 'poisoned'});

			expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 1001);
		});

		it('fails without touching state when the event is not in the log', async () => {
			vi.mocked(loadEffectiveEventTimes).mockReturnValue(
				succeeded('times', new Map([['evt-1', 5000]])),
			);

			const result = await checkoutStateAtEvent({eventId: 'missing'});

			expect(isSuccess(result)).toBe(false);
			expect(loadMergedEventsBefore).not.toHaveBeenCalled();
			expect(resetState).not.toHaveBeenCalled();
		});

		it('fails when the event carries no decodable time', async () => {
			vi.mocked(loadEffectiveEventTimes).mockReturnValue(
				succeeded('times', new Map([['evt-1', null]])),
			);

			const result = await checkoutStateAtEvent({eventId: 'evt-1'});

			expect(isSuccess(result)).toBe(false);
			expect(loadMergedEventsBefore).not.toHaveBeenCalled();
		});

		it('fails when the event times cannot be read', async () => {
			vi.mocked(loadEffectiveEventTimes).mockReturnValue(failed('unreadable'));

			const result = await checkoutStateAtEvent({eventId: 'evt-1'});

			expect(isSuccess(result)).toBe(false);
			if (isSuccess(result)) return;
			expect(result.message).toContain('unreadable');
			expect(resetState).not.toHaveBeenCalled();
		});
	});

	describe('returnToLive', () => {
		it('re-materializes the full event log and marks state live', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: '1'}, {id: '2'}] as never),
			);

			const result = await returnToLive();

			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}, {id: '2'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: false,
				readOnlyReason: undefined,
				timeMode: 'live',
				unappliedEvents: [],
				replay: null,
			});

			// The rebuild above dropped every load-derived lock, so reopening
			// writes without re-deriving them hands back a writable board over a
			// log this build cannot fully read.

			expect(isSuccess(result)).toBe(true);
		});

		it('clears the tracked as-of time so status reports live again', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 999});

			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));
			await returnToLive();

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		// Live flags plus a stale as-of clock is the incoherence to avoid.
		it('clears the tracked as-of time when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 4242});

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: '1'}] as never),
			);
			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

			const result = await returnToLive();

			expect(isSuccess(result)).toBe(false);
			expect(result.message).toContain('boom');
			expect(patchState).not.toHaveBeenCalledWith(
				expect.objectContaining({timeMode: 'live'}),
			);

			// The clock is only observable down the non-live branch.
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus().asOfTime).toBeNull();
		});
	});

	describe('runExclusive', () => {
		it('serializes overlapping operations instead of running them concurrently', async () => {
			const log: string[] = [];

			const first = runExclusive(async () => {
				log.push('first:start');
				await new Promise(resolve => setTimeout(resolve, 20));
				log.push('first:end');
			});

			const second = runExclusive(async () => {
				log.push('second:start');
				log.push('second:end');
			});

			await Promise.all([first, second]);

			expect(log).toEqual([
				'first:start',
				'first:end',
				'second:start',
				'second:end',
			]);
		});

		it('still runs a queued operation after an earlier one rejects', async () => {
			const first = runExclusive(async () => {
				throw new Error('boom');
			});

			let secondRan = false;
			const second = runExclusive(async () => {
				secondRan = true;
			});

			await expect(first).rejects.toThrow('boom');
			await second;

			expect(secondRan).toBe(true);
		});

		// A sync holding the lock must finish everything after its own await
		// before a queued checkout runs, or the scrub is clobbered.
		it("a checkout queued during an in-flight exclusive op waits for it, so it can't be clobbered", async () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			const log: string[] = [];
			let releaseSync: () => void = () => {};
			const syncGate = new Promise<void>(resolve => {
				releaseSync = resolve;
			});

			const fakeAutosyncTick = runExclusive(async () => {
				log.push('sync:start');
				await syncGate; // simulates the git round-trip
				log.push('sync:end');
			});

			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			const checkout = checkoutStateAt({targetTime: 1234}).then(result => {
				log.push('checkout:done');
				return result;
			});

			await new Promise(resolve => setTimeout(resolve, 10));
			expect(log).toEqual(['sync:start']);
			expect(patchState).not.toHaveBeenCalled();

			releaseSync();
			await fakeAutosyncTick;
			const result = await checkout;

			expect(log).toEqual(['sync:start', 'sync:end', 'checkout:done']);
			expect(isSuccess(result)).toBe(true);
		});
	});
});
