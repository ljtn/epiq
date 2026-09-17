import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

vi.mock('../lib/event/event-load.js', () => ({
	loadMergedEvents: vi.fn(),
	loadActorNames: vi.fn(() => new Map<string, string>()),
}));

// A real directory: what the cache watches is the log's own files, and a mocked
// filesystem would prove nothing about a teammate's file arriving in it.
vi.mock('../lib/storage/paths.js', async () => ({
	...(await vi.importActual<typeof import('../lib/storage/paths.js')>(
		'../lib/storage/paths.js',
	)),
	getEventsDirPath: (root: string) => path.join(root, 'events'),
}));

import {loadMergedEvents} from '../lib/event/event-load.js';
import {succeeded} from '../lib/model/result-types.js';
import {
	buildLaneIndex,
	buildLaneNames,
	buildTimelineEntries,
	clearTimelineCache,
	getTimelineEntries,
	lanesOpenAt,
} from '../mcp/timeline-index.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';

let root = '';
const eventsDir = () => path.join(root, 'events');

const writeLog = (actor: string, lines: number) => {
	fs.writeFileSync(
		path.join(eventsDir(), `${actor}.jsonl`),
		'x\n'.repeat(lines),
	);
};

const baseTime = 1_700_000_000_000;

const event = (n: number, over: Record<string, unknown> = {}) => ({
	id: ulid(baseTime + n * 1000),
	action: 'add.issue',
	payload: {id: `i${n}`, name: `Ticket ${n}`, parent: 'lane-1'},
	userId: 'u-1',
	userName: 'jo',
	...over,
});

const served = (events: unknown[]) => {
	vi.mocked(loadMergedEvents).mockReturnValue(
		succeeded('events', events as never),
	);
};

describe('timeline-index', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearTimelineCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-timeline-'));
		fs.mkdirSync(eventsDir());
		served([event(1), event(2)]);
	});

	afterEach(() => {
		fs.rmSync(root, {recursive: true, force: true});
	});

	describe('getTimelineEntries', () => {
		// The point of the whole thing: dragging the needle asks repeatedly for
		// windows over a log that has not moved.
		it('derives the log once and reuses it while nothing changes', () => {
			getTimelineEntries(root);
			getTimelineEntries(root);
			getTimelineEntries(root);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(1);
		});

		it('rebuilds once this machine has written an event', () => {
			writeLog('u-1', 2);
			getTimelineEntries(root);

			writeLog('u-1', 3);
			getTimelineEntries(root);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(2);
		});

		// Every actor appends to its own file, so a teammate's first event is a
		// file that was not there before — not a file that grew.
		it('rebuilds when a teammate’s log appears for the first time', () => {
			writeLog('u-1', 2);
			getTimelineEntries(root);

			writeLog('u-2', 1);
			getTimelineEntries(root);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(2);
		});

		it('rebuilds when a teammate’s existing log grows', () => {
			writeLog('u-1', 2);
			writeLog('u-2', 1);
			getTimelineEntries(root);

			writeLog('u-2', 4);
			getTimelineEntries(root);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(2);
		});

		// A sync can replace a file rather than append to it, leaving the length
		// where it was.
		it('rebuilds when a log is rewritten to the same length', () => {
			fs.writeFileSync(path.join(eventsDir(), 'u-1.jsonl'), 'aaaa');
			getTimelineEntries(root);

			const later = new Date(Date.now() + 5_000);
			fs.writeFileSync(path.join(eventsDir(), 'u-1.jsonl'), 'bbbb');
			fs.utimesSync(path.join(eventsDir(), 'u-1.jsonl'), later, later);
			getTimelineEntries(root);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(2);
		});

		it('serves a different project without answering from the first', () => {
			getTimelineEntries(root);

			const other = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-timeline-'));
			fs.mkdirSync(path.join(other, 'events'));
			getTimelineEntries(other);

			expect(vi.mocked(loadMergedEvents)).toHaveBeenCalledTimes(2);
			fs.rmSync(other, {recursive: true, force: true});
		});
	});

	describe('buildTimelineEntries', () => {
		it('puts the entries in effective-time order, whatever the log holds', () => {
			const entries = buildTimelineEntries([
				event(3),
				event(1),
				event(2),
			] as never);

			expect(entries.map(entry => entry.t)).toEqual(
				[...entries.map(entry => entry.t)].sort((a, b) => a - b),
			);
		});

		// `userName` on a loaded event is parsed back out of the log's file name,
		// which sanitizing lowercased and stripped — so the actor has to be
		// named out of the registry the tag and the assignee are named out of,
		// or the same person reads `claude-adolph` here and `claude/adolph`
		// where they are assigned.
		it('names an actor the way the log named them, not the way the file did', () => {
			const entries = buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'create.contributor',
					payload: {id: 'u-1', name: 'claude/adolph'},
					userId: 'u-1',
					userName: 'claude-adolph',
				},
				event(2, {userId: 'u-1', userName: 'claude-adolph'}),
			] as never);

			expect(entries.map(entry => entry.actor?.name)).toEqual([
				'claude/adolph',
				'claude/adolph',
			]);
		});

		// The colour is hashed from the name, so a name read two ways is a
		// person drawn in two colours.
		it('gives an actor the colour their assigned self is drawn in', () => {
			const entries = buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'create.contributor',
					payload: {id: 'u-1', name: 'claude/adolph'},
					userId: 'u-1',
					userName: 'claude-adolph',
				},
				{
					id: ulid(baseTime + 1000),
					action: 'add.issue.assignee',
					payload: {id: 'i1', assignee: 'u-1'},
					userId: 'u-1',
					userName: 'claude-adolph',
				},
			] as never);

			const assigning = entries[1]!;
			expect(assigning.actor?.color).toBe(assigning.assignee?.color);
		});

		// An id the log has no create event for keeps the file's copy: better a
		// lowercased name than a raw ULID.
		it('falls back to the file’s copy for an actor the log never named', () => {
			const [entry] = buildTimelineEntries(
				[event(1, {userId: 'u-9'})] as never,
				new Map([['u-9', 'someone-else']]),
			);

			expect(entry!.actor?.name).toBe('someone-else');
		});

		// An old board can name somebody in a file name and later rename them
		// with an event; the event is the newer truth.
		it('prefers a naming event over the file’s copy', () => {
			const [, entry] = buildTimelineEntries(
				[
					{
						id: ulid(baseTime),
						action: 'create.contributor',
						payload: {id: 'u-9', name: 'Renamed'},
						userId: 'u-9',
					},
					event(1, {userId: 'u-9'}),
				] as never,
				new Map([['u-9', 'someone-else']]),
			);

			expect(entry!.actor?.name).toBe('Renamed');
		});

		// Resolved once at build time so a request can narrow to its own board
		// over the window rather than walking the log again.
		it('carries the board each event belongs to', () => {
			const entries = buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'b1', name: 'Default'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 1000),
					action: 'add.swimlane',
					payload: {id: 'lane-1', name: 'Todo', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
				event(2),
			] as never);

			expect(entries.map(entry => entry.board)).toEqual(['b1', 'b1', 'b1']);
		});

		// A close is a move into the closed lane, which hangs off the Closed
		// board — read after the move, it belonged there, and the ticket's own
		// board never saw it go.
		it('attributes a close to the board the ticket was closed from', () => {
			const entries = buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'b1', name: 'Default'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 1000),
					action: 'add.swimlane',
					payload: {id: 'lane-1', name: 'Todo', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 2000),
					action: 'add.board',
					payload: {id: 'b-closed', name: 'Closed'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 3000),
					action: 'add.swimlane',
					payload: {id: 'lane-closed', name: 'Closed', parent: 'b-closed'},
					userId: 'u-1',
					userName: 'jo',
				},
				event(4),
				{
					id: ulid(baseTime + 5000),
					action: 'close.issue',
					payload: {id: 'i4', parent: 'lane-closed', rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 6000),
					action: 'reopen.issue',
					payload: {id: 'i4', parent: 'lane-1', rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
			] as never);

			expect(
				entries.slice(4).map(entry => [entry.action, entry.board]),
			).toEqual([
				['add.issue', 'b1'],
				['close.issue', 'b1'],
				['reopen.issue', 'b1'],
			]);
		});

		// What the flow chart places a ticket by: its lane after every event,
		// and the one a change of lane took it out of — so a window can draw
		// the ticket without the moves outside it.
		it('carries the lane a ticket is in after each event, and the one it left', () => {
			const entries = buildTimelineEntries([
				event(1),
				{
					id: ulid(baseTime + 2000),
					action: 'add.issue.comment',
					payload: {id: 'c1', issue: 'i1', md: 'hi'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 3000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-1', rank: 'b'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 4000),
					action: 'move.node',
					payload: {id: 'i1', parent: 'lane-2', rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 5000),
					action: 'close.issue',
					payload: {id: 'i1', parent: 'lane-closed', rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 6000),
					action: 'add.swimlane',
					payload: {id: 'lane-3', name: 'Later', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
			] as never);

			expect(
				entries.map(entry => [entry.action, entry.lane, entry.laneBefore]),
			).toEqual([
				['add.issue', 'lane-1', null],
				['add.issue.comment', 'lane-1', null],
				['move.node', 'lane-1', null],
				['move.node', 'lane-2', 'lane-1'],
				['close.issue', 'lane-closed', 'lane-2'],
				['add.swimlane', null, null],
			]);
		});

		it('leaves an event under no board with none', () => {
			const entries = buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'create.tag',
					payload: {id: 'tag-1', name: 'bug'},
					userId: 'u-1',
					userName: 'jo',
				},
			] as never);

			expect(entries[0]?.board).toBeNull();
		});
	});

	describe('lanesOpenAt', () => {
		const entries = (extra: unknown[] = []) =>
			buildTimelineEntries([
				{
					id: ulid(baseTime),
					action: 'add.board',
					payload: {id: 'b1', name: 'Default'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 1000),
					action: 'add.swimlane',
					payload: {id: 'lane-1', name: 'Todo', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 2000),
					action: 'add.swimlane',
					payload: {id: 'lane-2', name: 'Doing', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
				event(3),
				event(4),
				{
					id: ulid(baseTime + 5000),
					action: 'move.node',
					payload: {id: 'i3', parent: 'lane-2', rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 6000),
					action: 'add.issue.comment',
					payload: {id: 'c1', issue: 'i3', md: 'still here'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 7000),
					action: 'close.issue',
					payload: {id: 'i4', parent: CLOSED_SWIMLANE_ID, rank: 'a'},
					userId: 'u-1',
					userName: 'jo',
				},
				...extra,
			] as never);

		// What the flow chart draws a quiet window from: where every open ticket
		// sat as it began, whether or not anything happened to it inside.
		it('answers where every open ticket sat at a moment', () => {
			const index = buildLaneIndex(entries());

			expect(lanesOpenAt(index, baseTime + 2500)).toEqual({});
			expect(lanesOpenAt(index, baseTime + 4500)).toEqual({
				i3: 'lane-1',
				i4: 'lane-1',
			});
			expect(lanesOpenAt(index, baseTime + 6500)).toEqual({
				i3: 'lane-2',
				i4: 'lane-1',
			});
		});

		it('leaves out a ticket closed by then', () => {
			const index = buildLaneIndex(entries());

			expect(lanesOpenAt(index, baseTime + 8000)).toEqual({i3: 'lane-2'});
			expect(index.get('i4')?.closedFrom).toBe(baseTime + 7000);
			expect(index.get('i3')?.closedFrom).toBeNull();
		});

		// Closed and reopened is open: the close is not for good.
		it('keeps a reopened ticket', () => {
			const index = buildLaneIndex(
				entries([
					{
						id: ulid(baseTime + 9000),
						action: 'reopen.issue',
						payload: {id: 'i4', parent: 'lane-1', rank: 'a'},
						userId: 'u-1',
						userName: 'jo',
					},
				]),
			);

			expect(index.get('i4')?.closedFrom).toBeNull();
			expect(lanesOpenAt(index, baseTime + 9500)['i4']).toBe('lane-1');
		});

		// A change at the very moment is inside the window, not before it.
		it('reads a change at the moment itself as inside the window', () => {
			const index = buildLaneIndex(entries());

			expect(lanesOpenAt(index, baseTime + 5000)['i3']).toBe('lane-1');
		});

		it('narrows to the board asked for', () => {
			const index = buildLaneIndex(entries());

			expect(lanesOpenAt(index, baseTime + 4500, 'b1')).toEqual({
				i3: 'lane-1',
				i4: 'lane-1',
			});
			expect(lanesOpenAt(index, baseTime + 4500, 'b2')).toEqual({});
		});

		// A comment is no change of lane, so the index stays a list of moves.
		it('records only changes of lane', () => {
			const index = buildLaneIndex(entries());

			expect(index.get('i3')?.changes.map(change => change.lane)).toEqual([
				'lane-1',
				'lane-2',
			]);
		});
	});

	describe('buildLaneNames', () => {
		it('names every lane the log created, under its last name', () => {
			const lanes = buildLaneNames([
				{
					id: ulid(baseTime),
					action: 'add.swimlane',
					payload: {id: 'lane-1', name: 'Todo', parent: 'b1'},
					userId: 'u-1',
					userName: 'jo',
				},
				{
					id: ulid(baseTime + 1000),
					action: 'edit.title',
					payload: {id: 'lane-1', name: 'Ideas'},
					userId: 'u-1',
					userName: 'jo',
				},
				// A ticket's rename is not a lane's.
				{
					id: ulid(baseTime + 2000),
					action: 'edit.title',
					payload: {id: 'i1', name: 'Not a lane'},
					userId: 'u-1',
					userName: 'jo',
				},
			] as never);

			expect(lanes).toEqual({'lane-1': 'Ideas'});
		});
	});
});
