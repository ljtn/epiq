/**
 * The safety net around every git operation a sync runs.
 *
 * `withSyncLock` binds the processes that sync; nothing binds the processes
 * that write. So while one process hands the worktree to git — a checkout, a
 * `rebase --abort`, an autostash reverting the working copy to HEAD — another
 * may be appending to the same directory. Lines that were on disk before and
 * are not on disk after were lost by git; nothing removes one on purpose.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	restoreDroppedEventLines,
	snapshotEventLogs,
} from '../git/log-integrity.js';

const LOG = '01ksayra4ghekjp888wfbwbrdd.jola.jsonl';
const OTHER_LOG = '01m1fd32e0323znxekcy8yk9jr.bo.jsonl';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
	dirs.length = 0;
});

const line = (n: number) =>
	JSON.stringify({
		v: 1,
		id: [`01H${String(n).padStart(23, '0')}`, null],
		'lock.node': {id: 'x'},
	});

const makeRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-log-restore-'));
	dirs.push(root);
	fs.mkdirSync(path.join(root, '.epiq', 'events'), {recursive: true});
	return root;
};

const logPath = (root: string, name = LOG): string =>
	path.join(root, '.epiq', 'events', name);

const write = (root: string, lines: string[], name = LOG): void =>
	fs.writeFileSync(logPath(root, name), lines.join('\n') + '\n');

const read = (root: string, name = LOG): string[] =>
	fs
		.readFileSync(logPath(root, name), 'utf8')
		.split('\n')
		.filter(entry => entry.trim().length > 0);

describe('snapshotEventLogs', () => {
	it('reads every log in the events directory', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);
		write(root, [line(3)], OTHER_LOG);

		const snapshot = snapshotEventLogs(root);

		expect(snapshot.get(LOG)).toEqual([line(1), line(2)]);
		expect(snapshot.get(OTHER_LOG)).toEqual([line(3)]);
	});

	it('is empty rather than failing when there is no worktree yet', () => {
		expect(snapshotEventLogs('/does/not/exist').size).toBe(0);
	});
});

describe('restoreDroppedEventLines', () => {
	it('leaves an untouched log alone', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);

		const snapshot = snapshotEventLogs(root);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([]);
		expect(read(root)).toEqual([line(1), line(2)]);
	});

	// The autostash case: git reverts the working copy to HEAD and does not put
	// it back.
	it('puts back a line the log lost', () => {
		const root = makeRoot();
		write(root, [line(1), line(2), line(3)]);

		const snapshot = snapshotEventLogs(root);
		write(root, [line(1), line(3)]);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([`${LOG} (1)`]);
		expect(read(root).sort()).toEqual([line(1), line(2), line(3)].sort());
	});

	// `git rebase --abort` resets the worktree, and a checkout can remove a
	// file another actor had never committed.
	it('recreates a log the worktree lost entirely', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);

		const snapshot = snapshotEventLogs(root);
		fs.rmSync(logPath(root));

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([`${LOG} (2)`]);
		expect(read(root).sort()).toEqual([line(1), line(2)].sort());
	});

	// Order is not load-bearing — the loader derives it from refId — so a
	// reordered log has lost nothing and must not be rewritten.
	it('does not mind reordering', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);

		const snapshot = snapshotEventLogs(root);
		write(root, [line(2), line(1)]);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([]);
		expect(read(root)).toEqual([line(2), line(1)]);
	});

	// A concurrent writer's line is not in the snapshot, so restoring must not
	// disturb it — and lines pulled from a peer must survive too.
	it('keeps lines that arrived while git held the worktree', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);

		const snapshot = snapshotEventLogs(root);
		write(root, [line(1), line(9)]);

		restoreDroppedEventLines(root, snapshot);

		expect(read(root).sort()).toEqual([line(1), line(2), line(9)].sort());
	});

	/**
	 * A crash mid-append leaves a line with no id, which the loader quarantines
	 * and no replica can order. Putting it back would only re-dirty the file
	 * and give the next commit something to publish.
	 */
	it('does not put back a half-written line', () => {
		const root = makeRoot();
		fs.writeFileSync(logPath(root), `${line(1)}\n{"v":1,"id":["01H`);

		const snapshot = snapshotEventLogs(root);
		write(root, [line(1)]);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([]);
		expect(read(root)).toEqual([line(1)]);
	});

	it('splices onto a file git left without a trailing newline', () => {
		const root = makeRoot();
		write(root, [line(1), line(2)]);

		const snapshot = snapshotEventLogs(root);
		fs.writeFileSync(logPath(root), line(1));

		restoreDroppedEventLines(root, snapshot);

		expect(read(root)).toEqual([line(1), line(2)]);
	});

	it('restores each log independently', () => {
		const root = makeRoot();
		write(root, [line(1)]);
		write(root, [line(2), line(3)], OTHER_LOG);

		const snapshot = snapshotEventLogs(root);
		write(root, [], OTHER_LOG);
		fs.writeFileSync(logPath(root, OTHER_LOG), '');

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([
			`${OTHER_LOG} (2)`,
		]);
		expect(read(root)).toEqual([line(1)]);
		expect(read(root, OTHER_LOG).sort()).toEqual([line(2), line(3)].sort());
	});
});
