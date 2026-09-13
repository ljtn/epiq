import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	buildTimelineEntries,
	clearTimelineCache,
	getTimelineWindow,
} from '../mcp/timeline-index.js';
import {generateLog} from './stress/generate-log.js';

// The timeline index the Rust store derives against the TypeScript one, over
// a generated log with the shapes the labels care about added by hand.
describe('epiq-core timeline against buildTimelineEntries', () => {
	let stateRoot: string;
	let boardId = '';
	let laneIds: string[] = [];

	beforeAll(async () => {
		stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-timeline-'));
		const eventsDir = path.join(stateRoot, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		// A workspace, a board and two lanes with real create events, so moves
		// name their lane and boards attribute their events.
		const workspace = ulid();
		boardId = ulid();
		laneIds = [ulid(), ulid()];
		const tag = ulid();
		const contributor = ulid();
		const issue = ulid();
		let previous: string | null = null;
		const line = (action: string, payload: Record<string, unknown>) => {
			const id = ulid();
			const text =
				JSON.stringify({v: 1, id: [id, previous], [action]: payload}) + '\n';
			previous = id;
			return text;
		};

		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.jola.jsonl'),
			[
				line('init.workspace', {id: workspace, name: 'W', rank: 'a0'}),
				line('add.board', {
					id: boardId,
					name: 'Board',
					parent: workspace,
					rank: 'a0',
				}),
				line('add.swimlane', {
					id: laneIds[0],
					name: 'To do',
					parent: boardId,
					rank: 'a0',
				}),
				line('add.swimlane', {
					id: laneIds[1],
					name: 'Done',
					parent: boardId,
					rank: 'a1',
				}),
				line('create.tag', {id: tag, name: 'Bug'}),
				line('create.contributor', {id: contributor, name: 'claude/adolph'}),
				line('add.issue', {
					id: issue,
					name: 'A "quoted" title',
					parent: laneIds[0],
					rank: 'a0',
				}),
				line('add.issue.tag', {id: issue, tag}),
				line('add.issue.assignee', {id: issue, assignee: contributor}),
				line('add.issue.assignee', {id: issue, assignee: 'nobody-known'}),
				line('add.issue.comment', {
					id: ulid(),
					issue,
					author: contributor,
					md: '  First line is long: ' + 'x'.repeat(120) + '\nsecond line',
				}),
				line('add.issue.comment', {
					id: ulid(),
					issue,
					author: contributor,
					md: '',
				}),
				line('move.node', {id: issue, parent: laneIds[0], rank: 'a1'}),
				line('move.node', {id: issue, parent: laneIds[1], rank: 'a0'}),
				line('move.node', {id: issue, parent: 'no-such-lane', rank: 'a0'}),
				line('edit.title', {id: issue, name: 5}),
				line('edit.description', {id: issue, md: 'desc'}),
				line('tombstone.tag', {id: tag}),
				line('restore.tag', {id: tag, name: 'Bug'}),
				line('rename.contributor', {id: contributor, name: 'claude/adolf'}),
				line('lock.node', {id: issue}),
				line('close.issue', {id: issue, parent: laneIds[1], rank: 'a0'}),
				line('rebalance.children', {parent: laneIds[0], ranks: {}}),
				line('redact.contributor', {id: contributor}),
				'{"v":1,"id":["01H0000000000000000000000B",null],"lock.node"',
				JSON.stringify({
					v: 1,
					id: [ulid(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), previous],
					'lock.node': {id: issue},
				}),
			].join('\n') + '\n',
		);

		await generateLog({
			stateRoot,
			laneIds,
			actors: Array.from({length: 4}, (_, i) => ({
				userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${i}`,
				userName: `person${i}`,
			})),
			events: 6_000,
			years: 2,
			tagNames: ['gui', 'bug', 'sync'],
		});
	});

	afterAll(() => {
		fs.rmSync(stateRoot, {recursive: true, force: true});
	});

	const under = <T>(core: 'rust' | 'js', read: () => Result<T>): Result<T> => {
		const previous = process.env['EPIQ_CORE'];
		process.env['EPIQ_CORE'] = core;
		clearTimelineCache();

		try {
			return read();
		} finally {
			if (previous === undefined) delete process.env['EPIQ_CORE'];
			else process.env['EPIQ_CORE'] = previous;
			clearTimelineCache();
		}
	};

	it('derives the same entries, labels, identities and boards', () => {
		const events = under('js', () => loadMergedEvents(stateRoot));
		if (isFail(events) || !events.value) throw new Error(events.message);

		const expected = buildTimelineEntries(events.value).map(
			({board: _board, ...entry}) => entry,
		);

		const now = Date.now();
		const window = under('rust', () =>
			getTimelineWindow(stateRoot, {
				start: 0,
				end: now + 200 * 365 * 24 * 60 * 60 * 1000,
				cap: 1_000_000,
				now,
			}),
		);
		if (isFail(window) || !window.value) throw new Error(window.message);

		expect(window.value.entries.length).toBe(expected.length);
		expect(window.value.entries.length).toBeGreaterThan(6_000);
		expect(JSON.stringify(window.value.entries)).toBe(JSON.stringify(expected));
		expect(window.value.times).toEqual(expected.map(entry => entry.t));
	});

	it('answers a window, a board and the cap the same way under both cores', () => {
		const now = Date.now();
		const requests = [
			{cap: 20_000, now},
			{boardId, cap: 20_000, now},
			{
				start: now - 400 * 24 * 60 * 60 * 1000,
				end: now - 100 * 24 * 60 * 60 * 1000,
				cap: 20_000,
				now,
			},
			{start: now - 400 * 24 * 60 * 60 * 1000, end: now, cap: 10, now},
			{start: now, end: now - 1, cap: 20_000, now},
			{boardId: 'no-such-board', cap: 20_000, now},
		];

		for (const request of requests) {
			const rust = under('rust', () => getTimelineWindow(stateRoot, request));
			const js = under('js', () => getTimelineWindow(stateRoot, request));

			expect(rust.status).toBe('success');
			expect(JSON.stringify(rust)).toBe(JSON.stringify(js));
		}
	});

	it('answers an empty log the same way', () => {
		const empty = fs.mkdtempSync(
			path.join(os.tmpdir(), 'epiq-core-timeline-empty-'),
		);
		const now = Date.now();

		const rust = under('rust', () =>
			getTimelineWindow(empty, {cap: 20_000, now}),
		);
		const js = under('js', () => getTimelineWindow(empty, {cap: 20_000, now}));

		expect(JSON.stringify(rust)).toBe(JSON.stringify(js));
		fs.rmSync(empty, {recursive: true, force: true});
	});
});
