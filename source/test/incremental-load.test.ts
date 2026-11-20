import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from '../lib/event/ulid.js';
import * as warm from '../lib/board/board-log.js';
import {isFail, succeeded} from '../lib/model/result-types.js';
import {seededRandom} from './helpers/seeded-random.js';

// Every load a long-lived process makes, from whatever it holds, must equal a
// load by a process that holds nothing: over own writes, teammates' appends,
// rewrites, truncations, corrupt lines and new files.

let root = '';
const dir = () => path.join(root, '.epiq', 'events');
const OWN = '01ARZ3NDEKTSV4RRFFQ69G5FAV.me.jsonl';
// Sorts after every other file, so the scan reaches it last.
const GHOST = '01ARZ3NDEKTSV4RRFFQ69G5FAZ.ghost.jsonl';
const THEIRS = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAW.them.jsonl',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX.other.jsonl',
];

// Now and then a line that orders but does not decode: an action from a newer
// build, or a newer schema version.
const lineOf = (id: string, parent: string | null, n: number) =>
	`${JSON.stringify({
		v: parent && n % 13 === 7 ? 99 : 1,
		id: [id, parent],
		...(!parent
			? {'init.workspace': {id: 'w', name: 'W'}}
			: n % 11 === 5
			? {'future.action': {id: 'x'}}
			: {'edit.title': {id: 'x', name: `n${n}`}}),
	})}\n`;

// A process that holds nothing, its result put together from the order and a
// decode of it, never from the merged load the warm side runs.
const coldLoad = async () => {
	vi.resetModules();
	const cold = (await import(
		'../lib/board/board-log.js'
	)) as typeof import('../lib/board/board-log.js');
	const merged = cold.loadMergedEventsWithUnreadable(root);
	if (isFail(merged)) return merged;

	const order = cold.loadOrderedEntries(root);
	if (isFail(order)) return order;
	const unreadable = merged.value.unreadable.filter(
		entry => entry.reason === 'corrupt-line',
	);
	const decoded = cold.decodeReconstructedEvents(order.value, unreadable);
	if (isFail(decoded)) return decoded;

	return succeeded('', {events: decoded.value, unreadable});
};

const loaded = (
	result: ReturnType<typeof warm.loadMergedEventsWithUnreadable>,
) => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

beforeEach(() => {
	warm.clearEdgeCache();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-incremental-'));
	fs.mkdirSync(dir(), {recursive: true});
});

afterEach(() => {
	fs.rmSync(root, {recursive: true, force: true});
});

describe('a load from what the process holds', () => {
	it('equals a cold load after every step', async () => {
		for (let seed = 1; seed <= 12; seed++) {
			warm.clearEdgeCache();
			for (const file of fs.readdirSync(dir())) {
				fs.rmSync(path.join(dir(), file));
			}

			const random = seededRandom(seed);
			let clock = Date.UTC(2024, 0, 1) + seed * 1e7;
			const written: string[] = [];
			// Parents named but never written: one may be written later.
			const dangling: string[] = [];
			let n = 0;

			const genesis = ulid(clock);
			fs.writeFileSync(path.join(dir(), OWN), lineOf(genesis, null, n++));
			written.push(genesis);

			// Settled stamps, each distinct: a past mtime a millisecond apart.
			const touch = (file: string) => {
				const at = new Date(Date.UTC(2023, 0, 1) + n * 7 + seed);
				fs.utimesSync(path.join(dir(), file), at, at);
			};
			touch(OWN);

			for (let step = 0; step < 30; step++) {
				const tail = warm.getEdgeRef(root).value ?? genesis;
				const roll = random(20);
				clock += 1000;

				if (roll === 10 || roll === 11) {
					// A teammate's file grows; then, mid-scan, a new file vanishes
					// (the scan lists again) or a later read fails outright.
					const grown = path.join(dir(), THEIRS[0]!);
					const id = ulid(clock);
					fs.appendFileSync(grown, lineOf(id, tail, n++));
					written.push(id);
					touch(THEIRS[0]!);
					// At times the own file too, from another clone.
					const ownTheirs = random(2) === 0 ? ulid(clock - 2) : null;
					if (ownTheirs) {
						fs.appendFileSync(
							path.join(dir(), OWN),
							lineOf(ownTheirs, tail, n++),
						);
						written.push(ownTheirs);
						touch(OWN);
					}

					const later =
						roll === 10
							? path.join(dir(), GHOST)
							: path.join(dir(), THEIRS[1]!);
					if (roll === 11 && !fs.existsSync(later)) fs.writeFileSync(later, '');

					// The ghost appears after the signature is taken, in time for the
					// listing the scan reads: so the held signature never names it.
					const list = fs.readdirSync;
					let listings = 0;
					const listSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(((
						where: fs.PathLike,
						...rest: unknown[]
					) => {
						if (roll === 10 && String(where) === dir() && ++listings === 2) {
							fs.writeFileSync(later, lineOf(ulid(clock + 1), id, n++));
						}
						return (list as (...args: unknown[]) => unknown)(where, ...rest);
					}) as typeof fs.readdirSync);

					const read = fs.readFileSync;
					let tripped = false;
					const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
						file: fs.PathOrFileDescriptor,
						...rest: unknown[]
					) => {
						if (!tripped && String(file) === later) {
							tripped = true;
							if (roll === 10) fs.rmSync(later);
							else throw Object.assign(new Error('EACCES'), {code: 'EACCES'});
						}
						return (read as (...args: unknown[]) => unknown)(file, ...rest);
					}) as typeof fs.readFileSync);
					try {
						warm.loadMergedEventsWithUnreadable(root);
					} catch {
						// The failed load: what matters is the next one.
					}
					spy.mockRestore();
					listSpy.mockRestore();

					// At times an own write straight after, before any load succeeds.
					if (random(2) === 0) {
						const own = ulid(clock + 2);
						const line = lineOf(own, id, n++);
						const file = path.join(dir(), OWN);
						fs.appendFileSync(file, line);
						warm.advanceEdgeRef(root, OWN, own, Buffer.byteLength(line));
						warm.advanceSortedLog(root, file, line, Buffer.byteLength(line));
						written.push(own);
					}
				} else if (roll === 12) {
					// A sync renames a teammate's file away; its events stay elsewhere.
					const [from, to] = random(2) === 0 ? THEIRS : [...THEIRS].reverse();
					const source = path.join(dir(), from!);
					if (fs.existsSync(source)) {
						fs.appendFileSync(
							path.join(dir(), to!),
							fs.readFileSync(source, 'utf8').replace(/[^\n]$/, '$&\n'),
						);
						fs.rmSync(source);
						touch(to!);
					}
				} else if (roll === 6) {
					// The same actor writing from another clone, behind this
					// process's back, at times with no break after it.
					const id = ulid(clock);
					const line = lineOf(id, tail, n++);
					fs.appendFileSync(
						path.join(dir(), OWN),
						random(2) === 0 ? line : line.trimEnd(),
					);
					written.push(id);
					touch(OWN);
				} else if (roll < 10 && roll > 6) {
					// A teammate who had not seen the last few events, clock skewed:
					// one branch off a recent one, which may sort before what is held.
					const file = THEIRS[random(THEIRS.length)]!;
					const parent = written[Math.max(0, written.length - 1 - random(4))]!;
					const id = ulid(clock - 1000 * random(6));
					fs.appendFileSync(path.join(dir(), file), lineOf(id, parent, n++));
					written.push(id);
					touch(file);
				} else if (roll < 6) {
					// An own write, as persist makes it.
					const file = path.join(dir(), OWN);
					if (random(4) === 0) {
						// Another clone's line lands first, with no load between.
						const theirs = ulid(clock - 1);
						fs.appendFileSync(file, lineOf(theirs, tail, n++));
						written.push(theirs);
					}
					const id = ulid(clock);
					const line = lineOf(id, tail, n++);
					fs.appendFileSync(file, line);
					warm.advanceEdgeRef(root, OWN, id, Buffer.byteLength(line));
					warm.advanceSortedLog(root, file, line, Buffer.byteLength(line));
					written.push(id);
				} else {
					const file = THEIRS[random(THEIRS.length)]!;
					const target = path.join(dir(), file);
					const existing = fs.existsSync(target)
						? fs.readFileSync(target, 'utf8')
						: '';
					let text = '';
					for (let k = 0; k < 1 + random(3); k++) {
						const pick = random(10);
						const id =
							pick === 0
								? written[random(written.length)]!
								: pick === 1 && dangling.length > 0
								? dangling[random(dangling.length)]!
								: pick === 2
								? // A clock behind: sorts before siblings already held.
								  ulid(clock - 1000 * (1 + random(written.length)))
								: ulid(clock + k);
						const parentPick = random(10);
						const parent =
							parentPick < 5
								? tail
								: parentPick < 8
								? written[random(written.length)]!
								: ulid(clock - 500 + random(400));
						if (parentPick >= 8) dangling.push(parent);
						text += random(15) === 0 ? '{"broken\n' : lineOf(id, parent, n++);
						written.push(id);
					}

					const shape = random(10);
					if (shape === 0 && existing) {
						fs.writeFileSync(
							target,
							existing.slice(0, random(existing.length)) + text,
						);
					} else if (shape === 1 && existing) {
						fs.writeFileSync(target, existing.replace('n', 'm') + text);
					} else if (shape === 2) {
						fs.appendFileSync(target, text.trimEnd());
					} else {
						fs.appendFileSync(target, text);
					}
					touch(file);
				}

				const fromHeld = loaded(warm.loadMergedEventsWithUnreadable(root));
				expect(fromHeld).toEqual(loaded(await coldLoad()));
			}
		}
	}, 120_000);
});

describe('the parse cache at scale', () => {
	const actorFile = (index: number) =>
		`01ARZ3NDEKTSV4RRFF${String(index).padStart(8, '0')}.a${index}.jsonl`;

	const seed = (count: number): string => {
		let parent = ulid(Date.UTC(2023, 0, 1));
		fs.writeFileSync(path.join(dir(), actorFile(0)), lineOf(parent, null, 0));
		for (let index = 1; index < count; index++) {
			const id = ulid(Date.UTC(2023, 0, 1) + index);
			fs.writeFileSync(
				path.join(dir(), actorFile(index)),
				lineOf(id, parent, index),
			);
			parent = id;
		}
		const past = new Date(Date.UTC(2023, 0, 1));
		for (let index = 0; index < count; index++) {
			fs.utimesSync(path.join(dir(), actorFile(index)), past, past);
		}
		return parent;
	};

	it('appends a teammate past hundreds of actor files', () => {
		const tail = seed(700);
		expect(warm.loadOrderedEntries(root).message).toBe('All events loaded');

		const file = path.join(dir(), actorFile(350));
		fs.appendFileSync(file, lineOf(ulid(Date.UTC(2024, 0, 1)), tail, 1));
		fs.utimesSync(
			file,
			new Date(Date.UTC(2023, 1, 1)),
			new Date(Date.UTC(2023, 1, 1)),
		);

		expect(warm.loadOrderedEntries(root).message).toBe(
			'All events loaded, appended',
		);
	});

	it('forgets one board once another is read', () => {
		seed(5);
		const first = root;
		warm.loadOrderedEntries(first);

		const second = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-incremental-'));
		try {
			root = second;
			fs.mkdirSync(dir(), {recursive: true});
			seed(3);
			warm.loadOrderedEntries(second);

			root = first;
			// Touched, so the order is not served whole and the files are scanned.
			const past = new Date(Date.UTC(2023, 5, 1));
			fs.utimesSync(path.join(dir(), actorFile(0)), past, past);
			const spy = vi.spyOn(fs, 'readFileSync');
			warm.loadOrderedEntries(first);
			const reads = spy.mock.calls.filter(([file]) =>
				String(file).startsWith(first),
			);
			spy.mockRestore();
			expect(reads).toHaveLength(5);
		} finally {
			root = first;
			fs.rmSync(second, {recursive: true, force: true});
		}
	});
});
