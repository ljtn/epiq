import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	decodeReconstructedEvents,
	getSortedEvents,
	parsePersistedEventsFile,
	ReconstructedEvent,
	UnreadableEvent,
} from '../lib/event/event-load.js';
import {AppEvent} from '../lib/event/event.model.js';
import {coreCallJson} from '../lib/native/core.js';
import {encodeFrame} from '../lib/native/frame.js';
import {isFail} from '../lib/model/result-types.js';
import {generateLog} from './stress/generate-log.js';

type Decoded = {events: AppEvent[]; unreadable: UnreadableEvent[]};

// What the materializer receives — decoded events and the quarantine list —
// from the TypeScript decoder and from the Rust one, over the same files.
describe('epiq-core load with decode against decodeReconstructedEvents', () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	const tempDir = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-decode-'));
		dirs.push(dir);
		return dir;
	};

	const logNames = (eventsDir: string) =>
		fs
			.readdirSync(eventsDir)
			.filter(name => name.endsWith('.jsonl'))
			.sort();

	const viaTypeScript = (eventsDir: string): Decoded => {
		const unreadable: UnreadableEvent[] = [];
		const reconstructed: ReconstructedEvent[] = [];

		for (const name of logNames(eventsDir)) {
			const result = parsePersistedEventsFile(
				path.join(eventsDir, name),
				unreadable,
			);
			if (isFail(result) || !result.value) throw new Error(result.message);
			reconstructed.push(...result.value);
		}

		const decoded = decodeReconstructedEvents(
			getSortedEvents(reconstructed),
			unreadable,
		);
		if (isFail(decoded) || !decoded.value) throw new Error(decoded.message);

		return {events: decoded.value, unreadable};
	};

	const viaRust = (eventsDir: string): Decoded => {
		const frame = encodeFrame([
			{
				name: '@params',
				data: new TextEncoder().encode(
					JSON.stringify({now: Date.now(), decode: true}),
				),
			},
			...logNames(eventsDir).map(name => ({
				name,
				data: fs.readFileSync(path.join(eventsDir, name)),
			})),
		]);
		const result = coreCallJson<Decoded>('load', frame);
		if (isFail(result) || !result.value) throw new Error(result.message);

		return {events: result.value.events, unreadable: result.value.unreadable};
	};

	const line = (value: unknown) => JSON.stringify(value);

	it('agrees on every quarantine kind and every hostile payload shape', () => {
		const eventsDir = tempDir();
		const A = '01H0000000000000000000000A';
		const at = (suffix: string) => `01H000000000000000000000${suffix}`;

		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl'),
			[
				line({
					v: 1,
					id: [A, null],
					'init.workspace': {id: 'ws', name: 'W', rank: 'a0'},
				}),
				line({
					v: 1,
					id: [at('0B'), A],
					'add.swimlane': {id: 'lane', name: 'L', parent: 'ws', rank: 'a0'},
				}),
				line({
					v: 1,
					id: [at('0C'), at('0B')],
					'add.issue': {
						id: 'n1',
						name: 'numeric rank',
						parent: 'lane',
						rank: 42,
					},
				}),
				line({
					v: 1,
					id: [at('0D'), at('0C')],
					'add.issue': {id: 'n2', name: 'no rank', parent: 'lane'},
				}),
				line({
					v: 1,
					id: [at('0E'), at('0D')],
					'add.issue': {id: 7, name: 'numeric id', parent: 'lane', rank: 'a1'},
				}),
				line({
					v: 1,
					id: [at('0F'), at('0E')],
					'rebalance.children': {parent: 'lane', ranks: null},
				}),
				line({
					v: 1,
					id: [at('0G'), at('0F')],
					'rebalance.children': {
						parent: 'lane',
						ranks: {a: 1, b: 'r', c: null},
					},
				}),
				line({
					v: 1,
					id: [at('0H'), at('0G')],
					'edit.title': {id: 'ws', name: 5},
				}),
				line({
					v: 1,
					id: [at('0J'), at('0H')],
					'edit.title': 'a string payload',
				}),
				line({v: 1, id: [at('0K'), at('0J')], 'edit.title': null}),
				line({v: 1, id: [at('0M'), at('0K')], 'redact.contributor': {id: 'c'}}),
				line({
					v: 2,
					id: [at('0N'), at('0M')],
					'edit.title': {id: 'ws', name: 'future'},
				}),
				line({v: 1, id: [at('0P'), at('0N')]}),
				line({
					v: 1,
					id: [at('0Q'), at('0P')],
					'evil.event': {},
					'init.workspace': {id: 'ws', name: 'Forged'},
				}),
				line({
					v: 1,
					id: [at('0R'), at('0Q')],
					'add.issue.comment': {id: 'c1', issue: 'n1', md: 'no author'},
				}),
				line({
					v: 1,
					id: [at('0S'), at('0R')],
					'add.issue.attachment': {
						id: 'a1',
						issue: 'n1',
						hash: 'h',
						ext: 'odd',
						name: 'f',
						bytes: 12,
					},
				}),
				line({
					v: 1,
					id: [at('0T'), at('0S')],
					'add.issue.attachment': {
						id: 'a2',
						issue: 'n1',
						hash: '',
						ext: 'png',
						name: 'f',
						bytes: '12',
					},
				}),
				line({
					v: 1,
					id: [at('0V'), at('0T')],
					'edit.description': {
						id: 'n1',
						md: 'ok',
						unknownField: {deep: [1, 2.5, null]},
					},
				}),
				line({
					v: 1,
					id: [at('0W'), at('0V')],
					'link.contributor.user': {contributor: 'c'},
				}),
				line({
					v: 1,
					id: [at('0X'), at('0W')],
					'move.node': {id: 'n1', parent: 'n1', rank: 'a2'},
				}),
				'{"v":1,"id":["01H0000000000000000000000Y",null],"lock.node"',
				line({
					v: 1,
					id: [at('0Z'), at('0X')],
					'add.issue.assignee': {id: 'n1', assignee: ''},
				}),
			].join('\n') + '\n',
		);

		const ts = viaTypeScript(eventsDir);
		const rust = viaRust(eventsDir);

		expect(rust.events.map(e => e.action)).toEqual(
			ts.events.map(e => e.action),
		);
		expect(rust.unreadable.map(u => u.reason)).toEqual(
			ts.unreadable.map(u => u.reason),
		);
		expect(rust.unreadable.length).toBe(15);
		expect(JSON.stringify(rust)).toBe(JSON.stringify(ts));
	});

	it('agrees on a generated multi-actor log', async () => {
		const stateRoot = tempDir();

		await generateLog({
			stateRoot,
			laneIds: ['lane-1', 'lane-2', 'lane-3'],
			actors: Array.from({length: 4}, (_, i) => ({
				userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${i}`,
				userName: `person${i}`,
			})),
			events: 4_000,
			years: 1,
			tagNames: ['gui', 'bug'],
		});

		const eventsDir = path.join(stateRoot, '.epiq', 'events');
		const ts = viaTypeScript(eventsDir);
		const rust = viaRust(eventsDir);

		expect(rust.events.length).toBe(ts.events.length);
		expect(rust.unreadable).toEqual([]);
		expect(JSON.stringify(rust)).toBe(JSON.stringify(ts));
	});
});
