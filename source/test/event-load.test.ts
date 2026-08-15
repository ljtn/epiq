import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {describe, expect, it} from 'vitest';
import {
	decodeReconstructedEvents,
	getSortedEvents,
	loadMergedEvents,
	ReconstructedEvent,
	splitEventsAtTime,
} from '../lib/event/event-load.js';
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
