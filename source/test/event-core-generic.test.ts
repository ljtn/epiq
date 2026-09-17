import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {EventCatalog, EventHandlers} from '../lib/event/event-catalog.js';
import {createEventLog} from '../lib/event/event-log.js';
import {isConvergenceFail} from '../lib/event/event-materialize.js';
import {Event} from '../lib/event/event.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';

// The point of the split: a product that is not the board drives the whole
// log — ordering, replay, persistence — with its own event map and reducer,
// importing nothing from `lib/board`.

type ShapeMap = {
	'open.canvas': {payload: {id: string; name: string}; result: Canvas};
	'add.shape': {
		payload: {id: string; canvas: string; kind: string};
		result: Shape;
	};
	'move.shape': {payload: {id: string; x: number; y: number}; result: Shape};
	'erase.shape': {payload: {id: string}; result: Shape};
	// A handler this build gets wrong: it throws where it should have skipped.
	'broken.shape': {payload: {id: string}; result: Shape};
};

type Shape = {id: string; kind: string; x: number; y: number; erased: boolean};
type Canvas = {id: string; name: string};

type CanvasState = {
	canvas: Canvas | null;
	shapes: Record<string, Shape>;
	applied: string[];
};

let state: CanvasState;

const reset = () => {
	state = {canvas: null, shapes: {}, applied: []};
};

const apply: EventHandlers<ShapeMap> = {
	'open.canvas': event => {
		const canvas = {id: event.payload.id, name: event.payload.name};
		state.canvas = canvas;
		return succeeded('Opened canvas', {action: event.action, result: canvas});
	},

	'add.shape': event => {
		if (state.shapes[event.payload.id]) {
			return failed('shape already exists');
		}

		const shape: Shape = {
			id: event.payload.id,
			kind: event.payload.kind,
			x: 0,
			y: 0,
			erased: false,
		};
		state.shapes[shape.id] = shape;

		return succeeded('Added shape', {action: event.action, result: shape});
	},

	'move.shape': event => {
		const shape = state.shapes[event.payload.id];
		if (!shape) return failed('no such shape');

		const moved = {...shape, x: event.payload.x, y: event.payload.y};
		state.shapes[moved.id] = moved;

		return succeeded('Moved shape', {action: event.action, result: moved});
	},

	'erase.shape': event => {
		const shape = state.shapes[event.payload.id];
		if (!shape) return failed('no such shape');

		const erased = {...shape, erased: true};
		state.shapes[erased.id] = erased;

		return succeeded('Erased shape', {action: event.action, result: erased});
	},

	'broken.shape': event => {
		const shape = state.shapes[event.payload.id];
		// The bug: dereferences without checking, as a real handler eventually
		// will. Nothing above this fence catches it.
		return succeeded('Read a shape', {
			action: event.action,
			result: {...shape!, kind: shape!.kind.toUpperCase()},
		});
	},
};

const catalog: EventCatalog<ShapeMap> = {
	genesis: 'open.canvas',
	actions: [
		'open.canvas',
		'add.shape',
		'move.shape',
		'erase.shape',
		'broken.shape',
	],
	readPayload: (action, payload) =>
		payload && typeof payload === 'object' && 'id' in payload
			? succeeded('Payload is readable', undefined)
			: failed(`${action}: payload has no id`),
	apply,
	replay: {
		isInitialized: () => state.canvas !== null,
		batch: <T>(fn: () => T): Result<T> => succeeded('Batched', fn()),
		afterApply: event => {
			state.applied.push(event.action);
			return null;
		},
		flush: () => null,
	},
	write: {
		readOnlyReason: () => null,
		beforeWrite: () => succeeded('Nothing to do first', undefined),
	},
};

const log = createEventLog(catalog);

const actor = {userId: 'u1'};

let root: string;

const event = <A extends keyof ShapeMap & string>(
	id: string,
	action: A,
	payload: ShapeMap[A]['payload'],
): Event<ShapeMap, A> =>
	({id, action, payload, ...actor} as Event<ShapeMap, A>);

const openCanvas = () =>
	event('01J0000000000000000000000A', 'open.canvas', {
		id: 'canvas-1',
		name: 'Architecture',
	});

beforeEach(() => {
	reset();
	log.clearEdgeCache();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-test-'));
});

afterEach(() => {
	fs.rmSync(root, {recursive: true, force: true});
});

describe('the event log with a non-board catalog', () => {
	it('writes, reloads and replays to the same state', () => {
		const written = log.materializeAndPersistAll(
			[
				openCanvas(),
				event('placeholder-1', 'add.shape', {
					id: 'shape-1',
					canvas: 'canvas-1',
					kind: 'box',
				}),
				event('placeholder-2', 'move.shape', {id: 'shape-1', x: 4, y: 7}),
			],
			root,
		);

		expect(isFail(written)).toBe(false);
		expect(state.shapes['shape-1']).toMatchObject({x: 4, y: 7, kind: 'box'});

		const live = {...state.shapes};

		// A second machine's replay: same lines, same order, same state.
		reset();
		const loaded = log.loadMergedEvents(root);
		if (isFail(loaded)) throw new Error(loaded.message);

		const results = log.materializeAll(loaded.value);
		expect(results.every(result => !isFail(result))).toBe(true);
		expect(state.shapes).toEqual(live);
		expect(state.canvas?.name).toBe('Architecture');
	});

	it('mints each id past the edge it follows, and names that edge as its parent', () => {
		const written = log.materializeAndPersistAll(
			[
				openCanvas(),
				event('placeholder-1', 'add.shape', {
					id: 'shape-1',
					canvas: 'canvas-1',
					kind: 'box',
				}),
			],
			root,
		);
		if (isFail(written)) throw new Error(written.message);

		const lines = fs
			.readdirSync(path.join(root, '.epiq', 'events'))
			.flatMap(file =>
				fs
					.readFileSync(path.join(root, '.epiq', 'events', file), 'utf8')
					.split('\n')
					.filter(Boolean)
					.map(line => JSON.parse(line) as {id: [string, string | null]}),
			)
			.sort((a, b) => (a.id[0] < b.id[0] ? -1 : 1));

		expect(lines).toHaveLength(2);
		expect(lines[0]!.id[1]).toBeNull();
		expect(lines[1]!.id[1]).toBe(lines[0]!.id[0]);
		expect(lines[1]!.id[0] > lines[0]!.id[0]).toBe(true);
	});

	it('skips an event that arrives before genesis rather than failing the replay', () => {
		const results = log.materializeAll([
			event('01J000000000000000000000AA', 'add.shape', {
				id: 'orphan',
				canvas: 'canvas-1',
				kind: 'box',
			}),
			openCanvas(),
		]);

		expect(isConvergenceFail(results[0]!)).toBe(true);
		expect(isFail(results[1]!)).toBe(false);
		expect(state.canvas).not.toBeNull();
	});

	it('skips a second genesis rather than resetting the state', () => {
		const second = {
			...openCanvas(),
			id: '01J0000000000000000000000B',
			payload: {id: 'canvas-2', name: 'Forged'},
		};

		const results = log.materializeAll([openCanvas(), second]);

		expect(isConvergenceFail(results[1]!)).toBe(true);
		expect(state.canvas?.id).toBe('canvas-1');
	});

	it('fences a handler that throws into a skip', () => {
		const results = log.materializeAll([
			openCanvas(),
			event('01J0000000000000000000000C', 'broken.shape', {id: 'missing'}),
			event('01J0000000000000000000000D', 'add.shape', {
				id: 'shape-1',
				canvas: 'canvas-1',
				kind: 'box',
			}),
		]);

		// Skipped, not fatal, and the replay carries on past it.
		expect(isConvergenceFail(results[1]!)).toBe(true);
		expect(isFail(results[2]!)).toBe(false);
		expect(state.shapes['shape-1']).toBeDefined();
		expect(state.applied).toEqual(['open.canvas', 'add.shape']);
	});

	it('quarantines a line whose payload the catalog refuses', () => {
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		fs.writeFileSync(
			path.join(eventsDir, 'u1.drawer.jsonl'),
			[
				JSON.stringify({
					v: 1,
					id: ['01J0000000000000000000000A', null],
					'open.canvas': {id: 'canvas-1', name: 'Architecture'},
				}),
				JSON.stringify({
					v: 1,
					id: ['01J0000000000000000000000B', '01J0000000000000000000000A'],
					'add.shape': {canvas: 'canvas-1', kind: 'box'},
				}),
				JSON.stringify({
					v: 1,
					id: ['01J0000000000000000000000C', '01J0000000000000000000000B'],
					'from.the.future': {id: 'whatever'},
				}),
			].join('\n') + '\n',
		);

		const loaded = log.loadMergedEventsWithUnreadable(root);
		if (isFail(loaded)) throw new Error(loaded.message);

		expect(loaded.value.events.map(e => e.action)).toEqual(['open.canvas']);
		expect(loaded.value.unreadable.map(u => u.reason)).toEqual([
			'invalid-payload',
			'unknown-action',
		]);
	});
});
