import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {describe, expect, it} from 'vitest';
import {
	decodeReconstructedEvents,
	getSortedEvents,
	loadEventActors,
	loadMergedEvents,
	loadMergedEventsBefore,
	loadMergedEventsWithUnreadable,
	ReconstructedEvent,
	splitEventsAtTime,
} from '../lib/event/event-load.js';
import {persist} from '../lib/event/event-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';

describe('getSortedEvents', () => {
	const event = (
		id: string,
		afterRef: string | null,
		action = 'test.event',
	): ReconstructedEvent =>
		({
			id: afterRef ? [id, afterRef] : [id],
			[action]: {},
			userId: 'user',
			userName: 'User',
			v: 1,
		} as unknown as ReconstructedEvent);

	it('places an event after its insertion anchor even when input order is reversed', () => {
		const addIssue = event(
			'01KQN37Z9877YBRV6P2YG7Q62S',
			'01KQMFD60TR62NRKX8B32KNKWH',
		);
		const editTitle = event(
			'01KQN3C8WNF8Q8WXQYPF54S4MC',
			'01KQN37Z9877YBRV6P2YG7Q62S',
		);

		const sorted = getSortedEvents([
			editTitle,
			addIssue,
			event('01KQMFD60TR62NRKX8B32KNKWH', null),
		]);

		expect(sorted.map(e => e.id[0])).toEqual([
			'01KQMFD60TR62NRKX8B32KNKWH',
			'01KQN37Z9877YBRV6P2YG7Q62S',
			'01KQN3C8WNF8Q8WXQYPF54S4MC',
		]);
	});

	it('sorts multiple events with the same insertion anchor by ULID', () => {
		const root = event('01A', null);
		const c = event('01D', '01A');
		const a = event('01B', '01A');
		const b = event('01C', '01A');

		const sorted = getSortedEvents([c, root, b, a]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C', '01D']);
	});

	it('places anchored events immediately after their anchor, before later siblings', () => {
		const root = event('01A', null);
		const firstSibling = event('01B', '01A');
		const secondSibling = event('01C', '01A');
		const anchoredToFirstSibling = event('01D', '01B');

		const sorted = getSortedEvents([
			anchoredToFirstSibling,
			secondSibling,
			firstSibling,
			root,
		]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01D', '01C']);
	});

	it('does not reverse siblings when inserting multiple anchored events', () => {
		const root = event('01A', null);
		const first = event('01B', '01A');
		const second = event('01C', '01A');
		const third = event('01D', '01A');

		const sorted = getSortedEvents([third, second, first, root]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C', '01D']);
	});

	it('appends dangling events deterministically by ULID', () => {
		const root = event('01A', null);
		const danglingB = event('01B', 'missing-ref');
		const danglingC = event('01C', 'also-missing');

		const sorted = getSortedEvents([danglingC, root, danglingB]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C']);
	});

	// Two events sharing an id used to be settled by input order, which is
	// `readdirSync` order — so the same event set derived a different board on
	// each machine.
	it('orders two events sharing an id the same way whatever the input order', () => {
		const root = event('01A', null);
		const first = event('01B', '01A', 'edit.title');
		const second = {...event('01B', '01A', 'edit.title'), userName: 'Other'};

		const oneWay = getSortedEvents([root, first, second]);
		const otherWay = getSortedEvents([root, second, first]);

		expect(JSON.stringify(oneWay)).toBe(JSON.stringify(otherWay));
	});

	// Every event refs its predecessor, so a log is one chain as deep as it is
	// long. Recursing it overflowed the call stack at ~4.7k events, which meant
	// an ordinary board eventually stopped opening for everybody at once.
	it('orders a chain far longer than the call stack allows', () => {
		const chain: ReconstructedEvent[] = [];
		let previous: string | null = null;

		for (let index = 0; index < 50_000; index++) {
			const id = ulid(index + 1);
			chain.push(event(id, previous));
			previous = id;
		}

		const sorted = getSortedEvents(chain);

		expect(sorted).toHaveLength(chain.length);
		expect(sorted.map(e => e.id[0])).toEqual(chain.map(e => e.id[0]));
	});
});

describe('splitEventsAtTime', () => {
	const event = (
		id: string,
		afterRef: string | null,
		action = 'test.event',
	): ReconstructedEvent =>
		({
			id: afterRef ? [id, afterRef] : [id],
			[action]: {},
			userId: 'user',
			userName: 'User',
			v: 1,
		} as unknown as ReconstructedEvent);

	it('applies events before the target time', () => {
		const first = ulid(Date.now() - 10_000);
		const second = ulid(Date.now() - 5_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(first, null), event(second, null)],
			Date.now(),
		);

		expect(appliedEvents.map(e => e.id[0])).toEqual([first, second]);
		expect(unappliedEvents).toEqual([]);
	});

	it('unapplies events at the target time', () => {
		const targetTime = Date.now();
		const atTarget = ulid(targetTime);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(atTarget, null)],
			targetTime,
		);

		expect(appliedEvents).toEqual([]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([atTarget]);
	});

	it('unapplies events after the target time', () => {
		const past = ulid(Date.now() - 10_000);
		const future = ulid(Date.now() + 10_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(past, null), event(future, null)],
			Date.now(),
		);

		expect(appliedEvents.map(e => e.id[0])).toEqual([past]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([future]);
	});

	it('keeps children applied when parent is applied', () => {
		const parentId = ulid(Date.now() - 10_000);
		const childId = ulid(Date.now() - 5_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(parentId, null), event(childId, parentId)],
			Date.now(),
		);

		expect(appliedEvents.map(e => e.id[0])).toEqual([parentId, childId]);
		expect(unappliedEvents).toEqual([]);
	});

	it('unapplies children of unapplied events', () => {
		const parentId = ulid(Date.now() + 10_000);
		const childId = ulid(Date.now() - 10_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(parentId, null), event(childId, parentId)],
			Date.now(),
		);

		expect(appliedEvents).toEqual([]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([parentId, childId]);
	});

	it('propagates unapplied state through descendants', () => {
		const rootId = ulid(Date.now() + 10_000);
		const childId = ulid(Date.now() - 10_000);
		const grandChildId = ulid(Date.now() - 5_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[
				event(rootId, null),
				event(childId, rootId),
				event(grandChildId, childId),
			],
			Date.now(),
		);

		expect(appliedEvents).toEqual([]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([
			rootId,
			childId,
			grandChildId,
		]);
	});

	it('allows a later sibling to remain applied when only another sibling is unapplied', () => {
		const rootId = ulid(Date.now() - 20_000);
		const unappliedChildId = ulid(Date.now() + 10_000);
		const appliedChildId = ulid(Date.now() - 10_000);

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[
				event(rootId, null),
				event(appliedChildId, rootId),
				event(unappliedChildId, rootId),
			],
			Date.now(),
		);

		expect(appliedEvents.map(e => e.id[0])).toEqual([rootId, appliedChildId]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([unappliedChildId]);
	});

	it('treats invalid event ids as unapplied', () => {
		const invalidId = 'not-a-valid-ulid';

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			[event(invalidId, null)],
			Date.now(),
		);

		expect(appliedEvents).toEqual([]);
		expect(unappliedEvents.map(e => e.id[0])).toEqual([invalidId]);
	});
});

describe('decodeReconstructedEvents', () => {
	const entry = (
		id: string,
		action: string,
		payload: Record<string, unknown>,
	): ReconstructedEvent =>
		({
			id: [id, null],
			[action]: payload,
			userId: 'user',
			userName: 'User',
			v: 1,
		} as unknown as ReconstructedEvent);

	it('decodes known actions', () => {
		const result = decodeReconstructedEvents([
			entry('01KQMFD60TR62NRKX8B32KNKWH', 'edit.title', {
				id: 'node-1',
				name: 'Renamed',
			}),
		]);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.map(e => e.action)).toEqual(['edit.title']);
	});

	it('skips events with unknown actions instead of failing', () => {
		const result = decodeReconstructedEvents([
			entry('01KQMFD60TR62NRKX8B32KNKWH', 'edit.title', {
				id: 'node-1',
				name: 'Renamed',
			}),
			entry('01KQN37Z9877YBRV6P2YG7Q62S', 'future.mystery.action', {
				id: 'evt-2',
				issue: 'node-1',
				hash: 'abc',
			}),
			entry('01KQN3C8WNF8Q8WXQYPF54S4MC', 'edit.title', {
				id: 'node-1',
				name: 'Renamed again',
			}),
		]);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.map(e => e.action)).toEqual([
			'edit.title',
			'edit.title',
		]);
	});

	it('still fails on structurally invalid entries', () => {
		const malformed = {
			id: ['01KQMFD60TR62NRKX8B32KNKWH', null],
			userId: 'user',
			userName: 'User',
			v: 1,
		} as unknown as ReconstructedEvent;

		const result = decodeReconstructedEvents([malformed]);

		expect(isFail(result)).toBe(true);
	});
});

describe('loadMergedEvents with a corrupt line on disk', () => {
	const seedLog = (lines: string[]): string => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-corrupt-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl'),
			lines.join('\n') + '\n',
		);
		return root;
	};

	const workspaceLine = JSON.stringify({
		v: 1,
		id: ['01H0000000000000000000000A', null],
		'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
	});

	const titleLine = JSON.stringify({
		v: 1,
		id: ['01H0000000000000000000000C', '01H0000000000000000000000A'],
		'edit.title': {id: 'ws1', name: 'Renamed'},
	});

	// `merge=union` splices a half-written line into every clone that pulls it,
	// and the log is append-only. Failing the load there took the whole board
	// offline for everybody, permanently.
	it('skips a truncated line and still loads the rest', () => {
		const root = seedLog([
			workspaceLine,
			'{"v":1,"id":["01H0000000000000000000000B",null],"lock.node"',
			titleLine,
		]);

		const result = loadMergedEventsWithUnreadable(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.events.map(event => event.action)).toEqual([
			'init.workspace',
			'edit.title',
		]);
		expect(result.value.unreadable).toEqual([
			{
				eventId: null,
				reason: 'corrupt-line',
				detail: '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl:2 (invalid JSON)',
				targetNodeId: null,
			},
		]);
	});

	it('skips a line whose envelope is malformed and still loads the rest', () => {
		const root = seedLog([
			workspaceLine,
			JSON.stringify({v: 1, id: 'not-a-tuple', 'lock.node': {id: 'ws1'}}),
			titleLine,
		]);

		const result = loadMergedEventsWithUnreadable(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.events.map(event => event.action)).toEqual([
			'init.workspace',
			'edit.title',
		]);
		expect(result.value.unreadable).toHaveLength(1);
		expect(result.value.unreadable[0]?.reason).toBe('corrupt-line');
	});
});

describe('loadMergedEvents with foreign events on disk', () => {
	it('loads a log containing unknown actions without failing', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-load-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		const lines = [
			{
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			},
			{
				v: 1,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'future.mystery.action': {
					id: 'e2',
					issue: 't1',
					hash: 'deadbeef',
					ext: 'png',
					name: 'shot.png',
					bytes: 1234,
				},
			},
			{
				v: 1,
				id: ['01H0000000000000000000000C', '01H0000000000000000000000B'],
				'add.board': {id: 'b1', name: 'Board', parent: 'ws1', rank: 'a0'},
			},
		];
		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000F.alice.jsonl'),
			lines.map(l => JSON.stringify(l)).join('\n') + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.map(e => e.action)).toEqual([
			'init.workspace',
			'add.board',
		]);

		fs.rmSync(root, {recursive: true, force: true});
	});

	// File names lowercase the id for filesystem safety, but a ULID must come
	// back canonical or the same person appears twice.
	it('restores canonical ULID casing for the actor id parsed from the file name', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-case-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01ksayra4ghekjp888wfbwbrdd.alice.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value[0]?.userId).toBe('01KSAYRA4GHEKJP888WFBWBRDD');

		fs.rmSync(root, {recursive: true, force: true});
	});

	it('leaves a non-ULID actor id untouched', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-case2-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, 'legacy-user.alice.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value[0]?.userId).toBe('legacy-user');

		fs.rmSync(root, {recursive: true, force: true});
	});

	// Dots survive sanitizing, so a name segment may contain them. Splitting on
	// every dot truncated the name and collapsed distinct people onto one value.
	it('keeps a dotted user name intact when parsed from the file name', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-dot-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01ksayra4ghekjp888wfbwbrdd.j.-lampa.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value[0]?.userId).toBe('01KSAYRA4GHEKJP888WFBWBRDD');
		expect(result.value[0]?.userName).toBe('j.-lampa');

		fs.rmSync(root, {recursive: true, force: true});
	});

	// Only the first dot is a boundary: the id segment never contains one.
	it('keeps every dot of a multi-dot user name', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-dots-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01ksayra4ghekjp888wfbwbrdd.a.b.c-dev.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value[0]?.userId).toBe('01KSAYRA4GHEKJP888WFBWBRDD');
		// Casing is an id concern only; the name passes through as the file
		// carries it, so it still matches a re-encoded registry name.
		expect(result.value[0]?.userName).toBe('a.b.c-dev');

		fs.rmSync(root, {recursive: true, force: true});
	});

	it('falls back to an unknown user name when the file name has no dot', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-nodot-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01ksayra4ghekjp888wfbwbrdd.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value[0]?.userId).toBe('01KSAYRA4GHEKJP888WFBWBRDD');
		expect(result.value[0]?.userName).toBe('unknown');

		fs.rmSync(root, {recursive: true, force: true});
	});

	// Must fail as a Result, never throw.
	it('fails on a file name with an empty user name segment', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-empty-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01ksayra4ghekjp888wfbwbrdd..jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
			}) + '\n',
		);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('Invalid event file name');

		fs.rmSync(root, {recursive: true, force: true});
	});
});

describe('loadMergedEvents with a newer schema version on disk', () => {
	const workspace = (id: string, ref: string | null) => ({
		v: 1,
		id: [id, ref],
		'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
	});

	const write = (root: string, fileName: string, lines: unknown[]) => {
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		fs.writeFileSync(
			path.join(eventsDir, fileName),
			lines.map(line => JSON.stringify(line)).join('\n') + '\n',
		);
	};

	it('skips an unreadable line instead of failing the whole file', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-schema-'));

		write(root, '01H0000000000000000000000F.alice.jsonl', [
			workspace('01H0000000000000000000000A', null),
			{
				v: 2,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'add.board': {id: 'b0', name: 'From the future', parent: 'ws1'},
			},
			{
				v: 1,
				id: ['01H0000000000000000000000C', '01H0000000000000000000000B'],
				'add.board': {id: 'b1', name: 'Board', parent: 'ws1', rank: 'a0'},
			},
		]);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.map(e => e.action)).toEqual([
			'init.workspace',
			'add.board',
		]);

		fs.rmSync(root, {recursive: true, force: true});
	});

	// One teammate upgrading must not brick everyone still on the old build.
	it('keeps another actor loadable when one actor is entirely on a newer version', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-schema2-'));

		write(root, '01H0000000000000000000000F.alice.jsonl', [
			workspace('01H0000000000000000000000A', null),
		]);
		write(root, '01H0000000000000000000000E.bob.jsonl', [
			{
				v: 2,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'add.board': {id: 'b0', name: 'From the future', parent: 'ws1'},
			},
		]);

		const result = loadMergedEvents(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.map(e => e.action)).toEqual(['init.workspace']);

		fs.rmSync(root, {recursive: true, force: true});
	});

	// Read-side only: the newer events must survive to apply after an upgrade.
	it('leaves the skipped lines untouched on disk', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-schema3-'));
		const fileName = '01H0000000000000000000000F.alice.jsonl';

		write(root, fileName, [
			workspace('01H0000000000000000000000A', null),
			{
				v: 2,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'add.board': {id: 'b0', name: 'From the future', parent: 'ws1'},
			},
		]);

		const filePath = path.join(root, '.epiq', 'events', fileName);
		const before = fs.readFileSync(filePath, 'utf8');

		expect(isFail(loadMergedEvents(root))).toBe(false);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(before);

		fs.rmSync(root, {recursive: true, force: true});
	});

	// Time travel shares the load path, so a scrub must degrade the same way.
	it('degrades the same way on a historical read', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-schema4-'));

		write(root, '01H0000000000000000000000F.alice.jsonl', [
			workspace('01H0000000000000000000000A', null),
			{
				v: 2,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'add.board': {id: 'b0', name: 'From the future', parent: 'ws1'},
			},
		]);

		const result = loadMergedEventsBefore(root, Date.now());

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.appliedEvents.map(e => e.action)).toEqual([
			'init.workspace',
		]);

		fs.rmSync(root, {recursive: true, force: true});
	});
});

// An unreadable event still orders, still anchors, and still holds the events
// around it in place.
describe('ancestry through an unreadable event', () => {
	const A = '01H0000000000000000000000A';
	const B = '01H0000000000000000000000B';
	const C = '01H0000000000000000000000C';
	const D = '01H0000000000000000000000D';

	const chain = (versionOfB: number) => [
		{v: 1, id: [A, null], 'init.workspace': {id: 'ws1', name: 'W', rank: 'a0'}},
		{
			v: versionOfB,
			id: [B, A],
			'add.board': {id: 'bB', name: 'B', parent: 'ws1', rank: 'a1'},
		},
		{
			v: 1,
			id: [C, B],
			'add.board': {id: 'bC', name: 'C', parent: 'ws1', rank: 'a2'},
		},
		{
			v: 1,
			id: [D, A],
			'add.board': {id: 'bD', name: 'D', parent: 'ws1', rank: 'a3'},
		},
	];

	const loadIds = (lines: unknown[]): string[] => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-ancestry-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000F.alice.jsonl'),
			lines.map(line => JSON.stringify(line)).join('\n') + '\n',
		);

		const result = loadMergedEvents(root);
		fs.rmSync(root, {recursive: true, force: true});

		if (isFail(result)) throw new Error(result.message);
		return result.value.map(e => (e.payload as {id: string}).id);
	};

	// Eventual consistency: an older client's replay must be the newer client's
	// replay minus the unreadable events, never a different order.
	it('replays readable events in the same relative order as a client that reads everything', () => {
		const readsEverything = loadIds(chain(1));
		const cannotReadB = loadIds(chain(2));

		expect(readsEverything).toEqual(['ws1', 'bB', 'bC', 'bD']);
		expect(cannotReadB).toEqual(readsEverything.filter(id => id !== 'bB'));
	});
});

describe('edge ref across an unreadable event', () => {
	// Anchoring to the last *readable* event would fork a sibling branch, baked
	// into id[1] and unfixable by upgrading later.
	it('anchors a new event to the true latest event, not the latest readable one', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-edge-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		const readable = '01H0000000000000000000000A';
		const unreadable = '01H0000000000000000000000B';

		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000F.alice.jsonl'),
			[
				{
					v: 1,
					id: [readable, null],
					'init.workspace': {id: 'ws1', name: 'W', rank: 'a0'},
				},
				{
					v: 2,
					id: [unreadable, readable],
					'add.board': {id: 'bF', name: 'future', parent: 'ws1'},
				},
			]
				.map(line => JSON.stringify(line))
				.join('\n') + '\n',
		);

		const result = persist({
			event: {
				id: 'new-event',
				userId: '01H0000000000000000000000E',
				userName: 'bob',
				action: 'add.board',
				payload: {id: 'bNew', name: 'New', parent: 'ws1', rank: 'a4'},
			} as AppEvent,
			rootDir: root,
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.entry.id[1]).toBe(unreadable);

		fs.rmSync(root, {recursive: true, force: true});
	});
});

describe('locking what this build cannot read', () => {
	const write = (root: string, lines: unknown[]) => {
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000F.alice.jsonl'),
			lines.map(line => JSON.stringify(line)).join('\n') + '\n',
		);
	};

	const base = [
		{
			v: 1,
			id: ['01H0000000000000000000000A', null],
			'init.workspace': {id: 'ws1', name: 'W', rank: 'a0'},
		},
		{
			v: 1,
			id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
			'add.board': {id: 'b1', name: 'Board', parent: 'ws1', rank: 'a0'},
		},
	];

	it('reports the target node of an unreadable event so the lock can be scoped', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock-'));

		write(root, [
			...base,
			{
				v: 1,
				id: ['01H0000000000000000000000C', '01H0000000000000000000000B'],
				'future.mystery.action': {id: 'b1', hash: 'abc'},
			},
		]);

		const result = loadMergedEventsWithUnreadable(root);
		fs.rmSync(root, {recursive: true, force: true});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.unreadable).toEqual([
			{
				eventId: '01H0000000000000000000000C',
				reason: 'unknown-action',
				detail: 'future.mystery.action',
				targetNodeId: 'b1',
			},
		]);
	});

	it('reports a null target when the payload carries no node id', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock2-'));

		write(root, [
			...base,
			{
				v: 1,
				id: ['01H0000000000000000000000C', '01H0000000000000000000000B'],
				// Shaped like `rebalance.children`: no `id`.
				'future.bulk.action': {parent: 'ws1', ranks: {b1: 'a1'}},
			},
		]);

		const result = loadMergedEventsWithUnreadable(root);
		fs.rmSync(root, {recursive: true, force: true});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.unreadable[0]?.targetNodeId).toBeNull();
	});

	it('reports an unsupported schema version with its target', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock3-'));

		write(root, [
			...base,
			{
				v: 2,
				id: ['01H0000000000000000000000C', '01H0000000000000000000000B'],
				'edit.title': {id: 'b1', name: 'Renamed by the future'},
			},
		]);

		const result = loadMergedEventsWithUnreadable(root);
		fs.rmSync(root, {recursive: true, force: true});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.unreadable[0]).toMatchObject({
			reason: 'unsupported-schema-version',
			detail: 'v2',
			targetNodeId: 'b1',
		});
	});

	it('reports nothing when every event is readable', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock4-'));
		write(root, base);

		const result = loadMergedEventsWithUnreadable(root);
		fs.rmSync(root, {recursive: true, force: true});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.unreadable).toEqual([]);
	});
});

// Actors come off the file name, which no schema version can make unreadable.
describe('loadEventActors', () => {
	it('reports the author of an event this build cannot decode', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-actors-'));
		const eventsDir = path.join(root, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000F.alice.jsonl'),
			JSON.stringify({
				v: 1,
				id: ['01H0000000000000000000000A', null],
				'init.workspace': {id: 'ws1', name: 'W', rank: 'a0'},
			}) + '\n',
		);
		// Bob has written only events this build cannot read.
		fs.writeFileSync(
			path.join(eventsDir, '01H0000000000000000000000E.bob.jsonl'),
			JSON.stringify({
				v: 2,
				id: ['01H0000000000000000000000B', '01H0000000000000000000000A'],
				'add.board': {id: 'b0', name: 'future', parent: 'ws1'},
			}) + '\n',
		);

		const actors = loadEventActors(root);
		const events = loadMergedEvents(root);
		fs.rmSync(root, {recursive: true, force: true});

		expect(isFail(actors)).toBe(false);
		if (isFail(actors)) return;
		expect(isFail(events)).toBe(false);
		if (isFail(events)) return;

		const actorIds = new Set(actors.value.map(a => a.userId));
		const decodedIds = new Set(events.value.map(e => e.userId));

		// Bob authored, and the guard that refuses removing an author must see it.
		expect(actorIds.has('01H0000000000000000000000E')).toBe(true);
		expect(decodedIds.has('01H0000000000000000000000E')).toBe(false);
	});
});
