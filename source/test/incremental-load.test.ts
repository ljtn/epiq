import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import * as warm from '../lib/board/board-log.js';
import {isFail} from '../lib/model/result-types.js';
import {seededRandom} from './helpers/seeded-random.js';

// Every load a long-lived process makes, from whatever it holds, must equal a
// load by a process that holds nothing: over own writes, teammates' appends,
// rewrites, truncations, corrupt lines and new files.

let root = '';
const dir = () => path.join(root, '.epiq', 'events');
const OWN = '01ARZ3NDEKTSV4RRFFQ69G5FAV.me.jsonl';
const THEIRS = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAW.them.jsonl',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX.other.jsonl',
];

const lineOf = (id: string, parent: string | null, n: number) =>
	`${JSON.stringify({
		v: 1,
		id: parent ? [id, parent] : [id],
		...(parent
			? {'edit.title': {id: 'x', name: `n${n}`}}
			: {'init.workspace': {id: 'w', name: 'W'}}),
	})}\n`;

const coldLoad = async () => {
	vi.resetModules();
	const cold = (await import(
		'../lib/board/board-log.js'
	)) as typeof import('../lib/board/board-log.js');
	return cold.loadMergedEventsWithUnreadable(root);
};

const ids = (
	result: ReturnType<typeof warm.loadMergedEventsWithUnreadable>,
) => {
	if (isFail(result)) throw new Error(result.message);
	return {
		order: result.value.events.map(event => event.id),
		unreadable: result.value.unreadable,
	};
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

				if (roll === 6) {
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

				const fromHeld = ids(warm.loadMergedEventsWithUnreadable(root));
				expect(fromHeld).toEqual(ids(await coldLoad()));
			}
		}
	}, 120_000);
});
