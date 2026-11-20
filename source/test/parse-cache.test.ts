import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

import {
	clearEdgeCache,
	loadMergedEvents,
	loadMergedEventsWithUnreadable,
} from '../lib/board/board-log.js';
import {isFail} from '../lib/model/result-types.js';
import {
	clearParseCache,
	parsePersistedEventsFile,
} from '../lib/event/event-load.js';
import {seededRandom} from './helpers/seeded-random.js';

// A log file's parse is cached while the file is unchanged; it must never answer
// for a file that grew, was rewritten or replaced. A real directory, since that's what it watches.

let root = '';
const eventsDir = () => path.join(root, '.epiq', 'events');
const logPath = (actor: string) => path.join(eventsDir(), `${actor}.jsonl`);

const WS = '01H0000000000000000000WS01';
const BOARD = '01H0000000000000000000BD01';
const LANE = '01H0000000000000000000SW01';

const line = (id: string, refId: string | null, payload: object) =>
	`${JSON.stringify({...payload, v: 1, id: [id, refId]})}\n`;

// Genesis first, or nothing the log says afterwards is reachable.
const genesis = () => {
	const ws = ulid(1_700_000_000_000);
	const board = ulid(1_700_000_000_001);
	const lane = ulid(1_700_000_000_002);

	return {
		tail: lane,
		text:
			line(ws, null, {'init.workspace': {id: WS, name: 'W', rank: 'a0'}}) +
			line(board, ws, {
				'add.board': {id: BOARD, name: 'B', parent: WS, rank: 'a0'},
			}) +
			line(lane, board, {
				'add.swimlane': {id: LANE, name: 'L', parent: BOARD, rank: 'a0'},
			}),
	};
};

const issue = (id: string, refId: string, title: string) =>
	line(id, refId, {
		'add.issue': {id: ulid(), name: title, parent: LANE, rank: 'aQ'},
	});

// Backdates a file's mtime so the loader caches its parse; each call a second
// later, so no two writes share a stamp.
let settledAt = 0;

const settle = (filePath: string): Date => {
	settledAt += 1_000;
	const at = new Date(Date.now() - 600_000 + settledAt);
	fs.utimesSync(filePath, at, at);

	return at;
};

const titlesOf = (): string[] => {
	const result = loadMergedEvents(root);
	if (isFail(result)) throw new Error(result.message);

	return result.value
		.filter(event => event.action === 'add.issue')
		.map(event => (event.payload as {name: string}).name);
};

describe('the remembered parse of a log file', () => {
	beforeEach(() => {
		clearEdgeCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-parse-'));
		fs.mkdirSync(eventsDir(), {recursive: true});
	});

	afterEach(() => {
		fs.rmSync(root, {recursive: true, force: true});
	});

	it('gives the same answer twice over an unchanged log', () => {
		const {tail, text} = genesis();
		fs.writeFileSync(
			logPath('u-1'),
			text + issue(ulid(1_700_000_001_000), tail, 'first'),
		);

		expect(titlesOf()).toEqual(['first']);
		expect(titlesOf()).toEqual(['first']);
	});

	// The case the whole design turns on: this process's own write, a sync
	// pulling somebody else's, and git splicing a line in all look like this.
	it('sees a line appended after it answered once', () => {
		const {tail, text} = genesis();
		const first = ulid(1_700_000_001_000);
		fs.writeFileSync(logPath('u-1'), text + issue(first, tail, 'first'));

		expect(titlesOf()).toEqual(['first']);

		fs.appendFileSync(
			logPath('u-1'),
			issue(ulid(1_700_000_002_000), first, 'second'),
		);

		expect(titlesOf()).toEqual(['first', 'second']);
	});

	// A rewrite that happens to land on the same length — a rebase rewriting a
	// line, a repair — moves the mtime even where it does not move the size.
	it('sees a rewrite that kept the file the same length', () => {
		const {tail, text} = genesis();
		const id = ulid(1_700_000_001_000);
		fs.writeFileSync(logPath('u-1'), text + issue(id, tail, 'aaaaa'));

		expect(titlesOf()).toEqual(['aaaaa']);

		const rewritten = text + issue(id, tail, 'bbbbb');
		fs.writeFileSync(logPath('u-1'), rewritten);
		// Same length, so only the timestamp says anything changed — and the
		// filesystem's own resolution may not, on a write this quick.
		fs.utimesSync(logPath('u-1'), new Date(), new Date(Date.now() + 5_000));

		expect(titlesOf()).toEqual(['bbbbb']);
	});

	// A path a file was deleted from and another written to. `merge=union` and
	// the pending-log rotation both do this.
	it('sees a log removed and written again at the same path', () => {
		const {tail, text} = genesis();
		fs.writeFileSync(
			logPath('u-1'),
			text + issue(ulid(1_700_000_001_000), tail, 'first'),
		);
		settle(logPath('u-1'));

		expect(titlesOf()).toEqual(['first']);

		fs.rmSync(logPath('u-1'));
		fs.writeFileSync(
			logPath('u-1'),
			text + issue(ulid(1_700_000_002_000), tail, 'again'),
		);
		settle(logPath('u-1'));

		expect(titlesOf()).toEqual(['again']);
	});

	// Proves the cache exists: a same-length rewrite forced to the same mtime
	// can only return old content on a hit.
	it('answers a settled, unchanged log from what it remembered', () => {
		const {tail, text} = genesis();
		const id = ulid(1_700_000_001_000);
		fs.writeFileSync(logPath('u-1'), text + issue(id, tail, 'aaaaa'));
		const at = settle(logPath('u-1'));

		expect(titlesOf()).toEqual(['aaaaa']);

		fs.writeFileSync(logPath('u-1'), text + issue(id, tail, 'bbbbb'));
		fs.utimesSync(logPath('u-1'), at, at);

		expect(titlesOf()).toEqual(['aaaaa']);
	});

	// A file the clock hasn't left behind isn't cached, so a stamp collision
	// can't go stale; the mtime sits slightly ahead, as a fast peer clock writes.
	it('does not remember a log the clock has not left behind', () => {
		const {tail, text} = genesis();
		const id = ulid(1_700_000_001_000);
		const ahead = new Date(Date.now() + 60_000);

		fs.writeFileSync(logPath('u-1'), text + issue(id, tail, 'aaaaa'));
		fs.utimesSync(logPath('u-1'), ahead, ahead);

		expect(titlesOf()).toEqual(['aaaaa']);

		// Same length, and forced onto the same mtime: nothing a stamp reads has
		// changed, so only a refusal to remember can tell these apart.
		fs.writeFileSync(logPath('u-1'), text + issue(id, tail, 'bbbbb'));
		fs.utimesSync(logPath('u-1'), ahead, ahead);

		expect(titlesOf()).toEqual(['bbbbb']);
	});

	// A teammate's log appearing is a new file, not a changed one.
	it('sees a log that was not there when it answered', () => {
		const {tail, text} = genesis();
		fs.writeFileSync(
			logPath('u-1'),
			text + issue(ulid(1_700_000_001_000), tail, 'mine'),
		);

		expect(titlesOf()).toEqual(['mine']);

		fs.writeFileSync(
			logPath('u-2'),
			issue(ulid(1_700_000_002_000), tail, 'theirs'),
		);

		expect(titlesOf().sort()).toEqual(['mine', 'theirs']);
	});

	// A sync renames a pending log and deletes it; whatever it held must go.
	it('sees a log that was removed after it answered', () => {
		const {tail, text} = genesis();
		fs.writeFileSync(
			logPath('u-1'),
			text + issue(ulid(1_700_000_001_000), tail, 'mine'),
		);
		fs.writeFileSync(
			logPath('u-2'),
			issue(ulid(1_700_000_002_000), tail, 'theirs'),
		);

		expect(titlesOf().sort()).toEqual(['mine', 'theirs']);

		fs.rmSync(logPath('u-2'));

		expect(titlesOf()).toEqual(['mine']);
	});

	// FAT keeps even seconds: a write and a same-length rewrite a second later
	// share a whole-second stamp that is already past a fine tick.
	it('sees a same-length rewrite on a filesystem with whole-second stamps', () => {
		const {tail, text} = genesis();
		const file = logPath('u-1');
		const second = new Date(Math.floor((Date.now() - 500) / 1000) * 1000);

		fs.writeFileSync(
			file,
			text + issue(ulid(1_700_000_001_000), tail, 'first'),
		);
		fs.utimesSync(file, second, second);
		expect(titlesOf()).toEqual(['first']);

		fs.writeFileSync(
			file,
			text + issue(ulid(1_700_000_001_000), tail, 'other'),
		);
		fs.utimesSync(file, second, second);
		expect(titlesOf()).toEqual(['other']);
	});

	// Boot locks history on what is unreadable, so an answer from memory must
	// still name it.
	it('reports an unreadable line again when the log is unchanged', () => {
		const {text} = genesis();
		const file = logPath('u-1');
		fs.writeFileSync(
			file,
			text + '{"v":1,"id":["01H000000000000000000000ZZ"\n',
		);
		settle(file);

		const unreadableOf = () => {
			const result = loadMergedEventsWithUnreadable(root);
			if (isFail(result)) throw new Error(result.message);
			return result.value.unreadable.map(entry => entry.reason);
		};

		expect(unreadableOf()).toEqual(['corrupt-line']);
		expect(unreadableOf()).toEqual(['corrupt-line']);
	});

	// The caller concatenates and sorts what it is handed; doing that to the
	// cache's own array would reorder what the next reader sees.
	it('is not reordered by a caller sorting what it was handed', () => {
		const {tail, text} = genesis();
		const first = ulid(1_700_000_001_000);
		fs.writeFileSync(
			logPath('u-1'),
			text +
				issue(first, tail, 'first') +
				issue(ulid(1_700_000_002_000), first, 'second'),
		);

		const before = titlesOf();
		const handed = loadMergedEvents(root);
		if (isFail(handed)) throw new Error(handed.message);
		handed.value.reverse();

		expect(titlesOf()).toEqual(before);
	});
});

describe('the parse cache on a log past its size', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// The cache holds 300k lines.
	const seedLog = (files: number, linesPerFile: number): string => {
		const bigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-big-'));
		const eventsDir = path.join(bigRoot, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});

		const lineId = (n: number) => `01H${String(n).padStart(23, '0')}`;
		for (let file = 0; file < files; file++) {
			const lines = Array.from({length: linesPerFile}, (_, index) => {
				const n = file * linesPerFile + index;
				return `{"v":1,"id":["${lineId(n + 1)}","${lineId(n)}"],"x":{}}`;
			});
			const filePath = path.join(
				eventsDir,
				`01ARZ3NDEKTSV4RRFFQ69G5FA${file}.a.jsonl`,
			);
			fs.writeFileSync(filePath, lines.join('\n') + '\n');
			// Settled: a file written within a clock tick is never cached.
			fs.utimesSync(filePath, new Date(0), new Date(0));
		}

		return bigRoot;
	};

	const logReadsOfSecondLoad = (bigRoot: string): number => {
		clearEdgeCache();
		loadMergedEvents(bigRoot);
		// A new actor's log, so the second load is not answered whole.
		fs.writeFileSync(
			path.join(
				bigRoot,
				'.epiq',
				'events',
				'01ARZ3NDEKTSV4RRFFQ69G5FAZ.b.jsonl',
			),
			'{"v":1,"id":["01H99999999999999999999999",null],"x":{}}\n',
		);
		const read = vi.spyOn(fs, 'readFileSync');
		loadMergedEvents(bigRoot);

		return read.mock.calls.filter(([file]) => String(file).endsWith('.jsonl'))
			.length;
	};

	it('keeps every file however many lines, rereading only the new one', () => {
		expect(logReadsOfSecondLoad(seedLog(4, 80_000))).toBe(1);
	});

	it('keeps one file bigger than the cache', () => {
		expect(logReadsOfSecondLoad(seedLog(1, 310_000))).toBe(1);
	});
});

// A grown file is parsed from where the last parse stopped; anything else is
// parsed whole. Either way, exactly what a fresh parse gives.
describe('the parse of a file that grew', () => {
	let dir = '';
	beforeEach(() => {
		clearParseCache();
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-tail-'));
	});
	afterEach(() => {
		fs.rmSync(dir, {recursive: true, force: true});
	});

	const event = (n: number) =>
		JSON.stringify({
			v: 1,
			id: [`01H${String(n).padStart(23, '0')}`, null],
			'edit.title': {id: 'x', name: `n${n}`},
		});

	const parseOf = (file: string) => {
		const unreadable: unknown[] = [];
		const result = parsePersistedEventsFile(file, unreadable as never);
		if (isFail(result)) throw new Error(result.message);
		return {entries: result.value, unreadable};
	};

	it('equals a fresh parse after every append, rewrite and truncation', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const random = seededRandom(seed);
			const file = path.join(
				dir,
				`01ARZ3NDEKTSV4RRFFQ69G5F${String(seed).padStart(2, '0')}.a.jsonl`,
			);
			let text = '';
			let n = 0;
			let at = Date.now() - 3_600_000;

			for (let step = 0; step < 25; step++) {
				const lines = Array.from({length: 1 + random(4)}, () =>
					random(6) === 0 ? '{"broken' : event(n++),
				).join('\n');
				switch (random(6)) {
					case 0:
						// The start rewritten, the length grown.
						text = text.replace(/n\d/, 'm0') + lines + '\n';
						break;
					case 1:
						text = text.slice(0, random(text.length + 1)) + lines + '\n';
						break;
					case 2:
						// No break after the last line.
						text += lines;
						break;
					default:
						text += lines + '\n';
				}
				fs.writeFileSync(file, text);
				at += 1000;
				fs.utimesSync(file, new Date(at), new Date(at));

				const cached = parseOf(file);
				clearParseCache();
				const fresh = parseOf(file);
				// The fresh parse is now the cached one the next step builds on.
				expect(cached).toEqual(fresh);
			}
		}
	});
});
