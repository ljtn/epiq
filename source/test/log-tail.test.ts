import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {
	parsePersistedEventsFile,
	clearParseCache,
	sortEventsIndexed,
	type ReconstructedEvent,
} from '../lib/event/event-load.js';
import {readTail, tailOf, type LogTail} from '../lib/event/log-tail.js';
import {isSettledStamp, listEventFiles} from '../lib/event/log-signature.js';
import {
	appendPendingLine,
	flushPendingLogs,
	getPendingLogPath,
} from '../lib/event/pending-log.js';
import {isFail} from '../lib/model/result-types.js';
import {getEventsDirPath} from '../lib/storage/paths.js';
import {seededRandom} from './helpers/seeded-random.js';

// What tail reads add up to must be the order a full read of every file gives,
// through own writes, syncs folding them, teammates and corrupt lines; or a
// read says to rebuild.

const GENESIS = 'init.workspace';
const OWN = '01ARZ3NDEKTSV4RRFFQ69G5FAV.me.jsonl';
const THEIRS = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAW.them.jsonl',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX.other.jsonl',
];

let root = '';
const dir = () => getEventsDirPath(root);

beforeEach(() => {
	clearParseCache();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-tail-'));
	fs.mkdirSync(dir(), {recursive: true});
});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

const lineOf = (id: string, parent: string | null, n: number) =>
	`${JSON.stringify({
		v: 1,
		id: [id, parent],
		...(parent
			? {'edit.title': {id: 'x', name: `n${n}`}}
			: {[GENESIS]: {id: 'w', name: 'W'}}),
	})}\n`;

// Every file read whole, sorted: what a process starting now would hold.
const fullOrder = () => {
	clearParseCache();
	const entries: ReconstructedEvent[] = [];
	for (const name of listEventFiles(dir())) {
		const parsed = parsePersistedEventsFile(path.join(dir(), name));
		if (isFail(parsed)) throw new Error(parsed.message);
		for (const entry of parsed.value ?? []) entries.push(entry);
	}
	return sortEventsIndexed(entries, GENESIS);
};

const fresh = (): {order: ReconstructedEvent[]; tail: LogTail} => {
	const full = fullOrder();
	const tail = tailOf({
		dir: dir(),
		sorted: full.sorted,
		waiting: full.waiting,
		spine: full.spine,
		settledFor: isSettledStamp,
	});
	if (!tail) throw new Error('no tail');
	return {order: full.sorted, tail};
};

const keyOf = (order: readonly ReconstructedEvent[]) =>
	order.map(entry => JSON.stringify(entry));

describe('reading the log past where a process stopped', () => {
	it('adds up to a full read, through own writes, syncs and teammates', () => {
		let reads = 0;
		let appended = 0;
		let foldsAbsorbed = 0;

		for (let seed = 1; seed <= 25; seed++) {
			for (const name of fs.readdirSync(dir()))
				fs.rmSync(path.join(dir(), name));
			const random = seededRandom(seed);
			let clock = Date.UTC(2024, 0, 1) + seed * 1e8;
			let n = 0;
			const written: string[] = [];
			// Settled, and a new mtime each step: only a deliberate same-stamp
			// rewrite keeps one.
			let tick = 0;
			const touch = (name: string) => {
				const at = new Date(Date.UTC(2023, 0, 1) + tick * 7);
				if (fs.existsSync(path.join(dir(), name))) {
					fs.utimesSync(path.join(dir(), name), at, at);
				}
			};
			const touchAll = () => {
				tick++;
				fs.readdirSync(dir()).forEach(touch);
			};

			const genesis = ulid(clock);
			fs.writeFileSync(path.join(dir(), OWN), lineOf(genesis, null, n++));
			written.push(genesis);
			touchAll();

			let {order, tail} = fresh();

			for (let step = 0; step < 30; step++) {
				clock += 1000;
				const last = order.at(-1)!.id[0];
				const roll = random(12);
				let folded = false;
				let sameStamp = false;

				if (roll < 4) {
					// Own writes, as persist appends them.
					for (let k = 0; k < 1 + random(3); k++) {
						const id = ulid(clock + k);
						appendPendingLine(
							getPendingLogPath(root, OWN),
							lineOf(id, written.at(-1)!, n++),
						);
						written.push(id);
					}
				} else if (roll < 6) {
					// A sync folding them, one pass at a time: absorbed only if it
					// moved something.
					const ownSize = () => fs.statSync(path.join(dir(), OWN)).size;
					const before = ownSize();
					flushPendingLogs(root, OWN);
					folded = ownSize() > before;
				} else if (roll === 6) {
					// A teammate's file rewritten before where it was read to.
					const target = path.join(dir(), THEIRS[random(2)]!);
					if (fs.existsSync(target)) {
						const text = fs.readFileSync(target, 'utf8');
						fs.writeFileSync(target, text.replace(/n(\d)/, 'm$1'));
					}
				} else if (roll === 7) {
					// A teammate's file folded into the other's and removed.
					const [from, to] = random(2) === 0 ? THEIRS : [...THEIRS].reverse();
					const source = path.join(dir(), from!);
					if (fs.existsSync(source)) {
						// Its lines kept elsewhere, or lost outright.
						if (random(2) === 0) {
							fs.appendFileSync(path.join(dir(), to!), fs.readFileSync(source));
						}
						fs.rmSync(source);
					}
				} else if (roll === 8) {
					// Rewritten to the same size and mtime: only a process that
					// verifies what it starts from can tell.
					const target = path.join(dir(), THEIRS[random(2)]!);
					if (fs.existsSync(target)) {
						const {mtime} = fs.statSync(target);
						const text = fs.readFileSync(target, 'utf8');
						fs.writeFileSync(target, text.replace(/n(\d)/, 'q$1'));
						fs.utimesSync(target, mtime, mtime);
						sameStamp = true;
					}
				} else {
					const file = THEIRS[random(THEIRS.length)]!;
					const target = path.join(dir(), file);
					const pick = random(10);
					const parent =
						pick < 6
							? last
							: written[Math.max(0, written.length - 1 - random(5))]!;
					const id = pick === 9 ? ulid(clock - 1000 * random(10)) : ulid(clock);
					fs.appendFileSync(
						target,
						random(15) === 0 ? '{"broken\n' : lineOf(id, parent, n++),
					);
					written.push(id);
				}
				if (!sameStamp) touchAll();

				// Now and then as a process that just started from a snapshot,
				// always after a change its stamps would hide.
				const reading =
					sameStamp || random(5) === 0 ? {...tail, verified: false} : tail;
				const read = readTail(dir(), reading, isSettledStamp);
				reads++;
				const full = fullOrder();

				if ('rebuild' in read) {
					({order, tail} = fresh());
				} else {
					appended++;
					if (folded) foldsAbsorbed++;
					order = [...order, ...read.appended];
					tail = read.tail;
					expect(keyOf(order)).toEqual(keyOf(full.sorted));
				}
			}
		}

		// Declining every read would pass the check above and prove nothing.
		expect(appended).toBeGreaterThan(reads / 2);
		expect(foldsAbsorbed).toBeGreaterThan(10);
	});
});
