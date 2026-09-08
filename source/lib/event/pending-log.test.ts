import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {isSuccess, Result} from '../model/result-types.js';
import {
	appendPendingLine,
	flushPendingLogs,
	hasPendingLines,
	isPendingFileName,
	toPendingFileName,
	trackedFileNameFor,
} from './pending-log.js';

const TRACKED = '01hzz.ana.jsonl';
const PENDING = '01hzz~pending.ana.jsonl';

let root: string;
let eventsDir: string;

const unwrap = <T>(result: Result<T>): T => {
	if (!isSuccess(result)) throw new Error(result.message);
	return result.value;
};

const write = (name: string, lines: string[]) =>
	fs.writeFileSync(
		path.join(eventsDir, name),
		lines.map(line => `${line}\n`).join(''),
	);

const linesOf = (name: string): string[] => {
	const filePath = path.join(eventsDir, name);
	if (!fs.existsSync(filePath)) return [];

	return fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter(line => line.trim().length > 0);
};

const namesIn = (): string[] => fs.readdirSync(eventsDir).sort();

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-pending-'));
	eventsDir = path.join(root, '.epiq', 'events');
	fs.mkdirSync(eventsDir, {recursive: true});
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(root, {recursive: true, force: true});
});

describe('the pending log name', () => {
	it('marks the id segment, which is the one that cannot hold a dot', () => {
		expect(toPendingFileName(TRACKED)).toBe(PENDING);
		expect(trackedFileNameFor(PENDING)).toBe(TRACKED);
	});

	// The whole reason the marker is not a `.pending` suffix: a name may contain
	// dots, so a contributor actually called "pending" would be unreadable from
	// a real pending file.
	it('does not mistake a contributor named "pending" for a pending file', () => {
		expect(trackedFileNameFor('01hzz.pending.jsonl')).toBeNull();
		expect(isPendingFileName('01hzz.pending.jsonl')).toBe(false);
	});

	it('survives a name that contains dots of its own', () => {
		const tracked = '01hzz.j.-lampa.jsonl';

		expect(trackedFileNameFor(toPendingFileName(tracked))).toBe(tracked);
	});

	// A rotated file is still read and still resolves to the same actor, so
	// events stay visible while a flush is part-way through.
	it('recognises a rotated file, and resolves it to the same log', () => {
		const rotated = '01hzz~pending-01abc.ana.jsonl';

		expect(isPendingFileName(rotated)).toBe(true);
		expect(trackedFileNameFor(rotated)).toBe(TRACKED);
	});

	it('leaves an ordinary log alone', () => {
		expect(trackedFileNameFor(TRACKED)).toBeNull();
		expect(isPendingFileName(TRACKED)).toBe(false);
	});
});

describe('flushing pending logs', () => {
	it('does nothing when there is nothing pending', () => {
		write(TRACKED, ['a']);

		expect(unwrap(flushPendingLogs(root, TRACKED))).toBe(0);
		expect(linesOf(TRACKED)).toEqual(['a']);
	});

	it('folds the pending lines onto the end of the tracked log', () => {
		write(TRACKED, ['a', 'b']);
		write(PENDING, ['c', 'd']);

		expect(unwrap(flushPendingLogs(root, TRACKED))).toBe(2);
		expect(linesOf(TRACKED)).toEqual(['a', 'b', 'c', 'd']);
		expect(namesIn()).toEqual([TRACKED]);
	});

	it('creates the tracked log when the actor has only ever written pending', () => {
		write(PENDING, ['a']);

		unwrap(flushPendingLogs(root, TRACKED));

		expect(linesOf(TRACKED)).toEqual(['a']);
	});

	// A crash between the append and the delete leaves a rotated file behind.
	// The next flush has to find it — that is the whole reason it globs rather
	// than looking only at the live name.
	it('picks up a rotated file a crashed flush left behind', () => {
		write(TRACKED, ['a']);
		write('01hzz~pending-01abc.ana.jsonl', ['stranded']);

		expect(unwrap(flushPendingLogs(root, TRACKED))).toBe(1);
		expect(linesOf(TRACKED)).toEqual(['a', 'stranded']);
		expect(namesIn()).toEqual([TRACKED]);
	});

	it('folds a stray and the live file in the same pass', () => {
		write(TRACKED, ['a']);
		write('01hzz~pending-01abc.ana.jsonl', ['stranded']);
		write(PENDING, ['live']);

		unwrap(flushPendingLogs(root, TRACKED));

		expect(linesOf(TRACKED).sort()).toEqual(['a', 'live', 'stranded']);
		expect(namesIn()).toEqual([TRACKED]);
	});

	// A sync commits only its own file. Folding another actor's pending lines
	// would leave them dirty in a tracked file through the rebase, in no commit
	// and no snapshot — so they stay where git cannot reach them.
	it("leaves another actor's pending log where it is", () => {
		write('01hzz.ana.jsonl', ['ana-1']);
		write('01hzz~pending.ana.jsonl', ['ana-2']);
		write('02aaa.bo.jsonl', ['bo-1']);
		write('02aaa~pending.bo.jsonl', ['bo-2']);

		unwrap(flushPendingLogs(root, '01hzz.ana.jsonl'));

		expect(linesOf('01hzz.ana.jsonl')).toEqual(['ana-1', 'ana-2']);
		expect(linesOf('02aaa.bo.jsonl')).toEqual(['bo-1']);
		expect(linesOf('02aaa~pending.bo.jsonl')).toEqual(['bo-2']);
	});

	// A line that is not newline-terminated would otherwise be joined to the
	// first line of the tracked log's next append — two events lost, and union
	// merge relies on every line standing alone.
	it('terminates a final line the writer left unterminated', () => {
		write(TRACKED, ['a']);
		fs.writeFileSync(path.join(eventsDir, PENDING), 'b');

		unwrap(flushPendingLogs(root, TRACKED));

		expect(linesOf(TRACKED)).toEqual(['a', 'b']);
		expect(fs.readFileSync(path.join(eventsDir, TRACKED), 'utf8')).toMatch(
			/\n$/,
		);
	});

	// The other side of the same splice: a tracked log that ends in a partial
	// line — a crash mid-append, or a git truncation — must not have the first
	// pending line glued onto it.
	it('separates the pending lines from a partial tail in the tracked log', () => {
		fs.writeFileSync(path.join(eventsDir, TRACKED), 'a\n{"id":["b",nu');
		write(PENDING, ['c', 'd']);

		unwrap(flushPendingLogs(root, TRACKED));

		expect(linesOf(TRACKED)).toEqual(['a', '{"id":["b",nu', 'c', 'd']);
	});

	it('leaves an empty pending file behind no trace', () => {
		write(TRACKED, ['a']);
		fs.writeFileSync(path.join(eventsDir, PENDING), '');

		expect(unwrap(flushPendingLogs(root, TRACKED))).toBe(0);
		expect(linesOf(TRACKED)).toEqual(['a']);
		expect(namesIn()).toEqual([TRACKED]);
	});

	it('is safe to run twice', () => {
		write(TRACKED, ['a']);
		write(PENDING, ['b']);

		unwrap(flushPendingLogs(root, TRACKED));
		unwrap(flushPendingLogs(root, TRACKED));

		expect(linesOf(TRACKED)).toEqual(['a', 'b']);
	});

	it('shrugs off an events directory that is not there yet', () => {
		fs.rmSync(eventsDir, {recursive: true, force: true});

		expect(unwrap(flushPendingLogs(root, TRACKED))).toBe(0);
	});
});

describe('appending to a pending log', () => {
	it('appends a line', () => {
		appendPendingLine(path.join(eventsDir, PENDING), 'a\n');
		appendPendingLine(path.join(eventsDir, PENDING), 'b\n');

		expect(linesOf(PENDING)).toEqual(['a', 'b']);
	});

	// The writer opened the file, then a flush renamed it, read it and deleted
	// it, and only then did the write happen. O_APPEND follows the inode, so
	// the line went into the file that was just deleted. Reproduced exactly by
	// running the flush between the open and the write.
	it('keeps a line written into a file a flush rotated underneath it', () => {
		write(PENDING, ['before']);

		const writeSync = fs.writeSync;
		vi.spyOn(fs, 'writeSync').mockImplementationOnce(((
			fd: number,
			data: string,
		) => {
			unwrap(flushPendingLogs(root, TRACKED));
			return writeSync(fd, data);
		}) as typeof fs.writeSync);

		appendPendingLine(path.join(eventsDir, PENDING), 'during\n');

		expect(linesOf(TRACKED)).toEqual(['before']);
		expect(linesOf(PENDING)).toEqual(['during']);
	});
});

describe('whether pending lines are held', () => {
	it('is false with no pending logs, or only empty ones', () => {
		write(TRACKED, ['a']);
		expect(hasPendingLines(root)).toBe(false);

		fs.writeFileSync(path.join(eventsDir, PENDING), '');
		expect(hasPendingLines(root)).toBe(false);
	});

	it("is true for any actor's pending lines, live or rotated", () => {
		write('02aaa~pending-01abc.bo.jsonl', ['bo']);

		expect(hasPendingLines(root)).toBe(true);
	});

	it('is false when the events directory does not exist', () => {
		fs.rmSync(eventsDir, {recursive: true, force: true});

		expect(hasPendingLines(root)).toBe(false);
	});
});
