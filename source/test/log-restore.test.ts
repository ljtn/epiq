/**
 * The safety net around a sync's git operations: writers aren't locked out, so
 * lines on disk before git ran and missing after were lost by git.
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

		expect(snapshot.get(LOG)?.toString()).toBe(`${line(1)}\n${line(2)}\n`);
		expect(snapshot.get(OTHER_LOG)?.toString()).toBe(`${line(3)}\n`);
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

	/** A half-written line has no id and no order, so it is never put back. */
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

	it('leaves a log that only grew alone', () => {
		const root = makeRoot();
		write(root, [line(1)]);

		const snapshot = snapshotEventLogs(root);
		write(root, [line(1), line(2)]);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([]);
		expect(read(root)).toEqual([line(1), line(2)]);
	});

	// Still a prefix, but its last line, which had no newline, became another.
	it('puts back a last line that grew into a different one', () => {
		const root = makeRoot();
		fs.writeFileSync(logPath(root), `${line(1)}\n${line(2)}`);

		const snapshot = snapshotEventLogs(root);
		fs.writeFileSync(logPath(root), `${line(1)}\n${line(2)}${line(3)}\n`);

		expect(restoreDroppedEventLines(root, snapshot)).toEqual([`${LOG} (1)`]);
		expect(read(root)).toContain(line(2));
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

// The net before it compared prefixes, kept as the reference the faster one must match.
const referenceRestore = (
	root: string,
	before: ReadonlyMap<string, Buffer>,
): string[] => {
	const linesOf = (text: string) =>
		text.split('\n').filter(entry => entry.trim().length > 0);
	const restorable = (text: string) => {
		try {
			const parsed: unknown = JSON.parse(text);
			return typeof parsed === 'object' && parsed !== null;
		} catch {
			return false;
		}
	};
	const repaired: string[] = [];

	for (const [name, bytes] of before) {
		const lines = linesOf(bytes.toString('utf8'));
		if (lines.length === 0) continue;

		const file = logPath(root, name);
		const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
		const present = new Set(content === null ? [] : linesOf(content));
		const dropped = lines.filter(l => !present.has(l)).filter(restorable);
		if (dropped.length === 0) continue;

		const needsNewline =
			content !== null && content.length > 0 && !content.endsWith('\n');
		fs.appendFileSync(
			file,
			`${needsNewline ? '\n' : ''}${dropped.join('\n')}\n`,
		);
		repaired.push(`${name} (${dropped.length})`);
	}

	return repaired;
};

describe('restoreDroppedEventLines against the reference', () => {
	it('repairs exactly as the line-by-line check did, over random rewrites', () => {
		let seed = 11;
		const random = (n: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return (seed >>> 16) % n;
		};
		const text = (lines: string[], newline: boolean) =>
			lines.join('\n') + (newline && lines.length > 0 ? '\n' : '');
		const wide = (n: number) =>
			JSON.stringify({
				v: 1,
				id: [`01H${String(n).padStart(23, '0')}`, null],
				'edit.title': {id: 'x', name: 'Ångström ✓ 🚀'},
			});
		const rewrite = (
			lines: string[],
			before: string,
		): string | Buffer | null => {
			switch (random(8)) {
				case 6:
					// Written straight onto a log that may end without a newline.
					return before + line(300) + '\n';
				case 0:
					return null;
				case 1:
					return text([...lines, line(100 + random(50))], random(2) === 0);
				case 2:
					return text(
						lines.filter(() => random(3) > 0),
						random(2) === 0,
					);
				case 3:
					return text([...lines].reverse(), true);
				case 4: {
					// Cut at a byte, which may land inside a character.
					const whole = Buffer.from(text(lines, true));
					return whole.subarray(0, random(whole.length + 1));
				}
				case 5:
					return text(lines, true) + line(200).slice(0, 10);
				default:
					return text(lines, random(2) === 0);
			}
		};

		for (let run = 0; run < 300; run++) {
			const lines = Array.from({length: random(6)}, () =>
				random(3) === 0 ? wide(random(40)) : line(random(40)),
			);
			const before = text(lines, random(3) > 0);
			const after = rewrite(lines, before);

			const outcomes = [restoreDroppedEventLines, referenceRestore].map(
				restore => {
					const root = makeRoot();
					fs.writeFileSync(logPath(root), before);
					const snapshot = snapshotEventLogs(root);
					if (after === null) fs.rmSync(logPath(root));
					else fs.writeFileSync(logPath(root), after);

					const repaired = restore(root, snapshot);
					const file = fs.existsSync(logPath(root))
						? fs.readFileSync(logPath(root), 'utf8')
						: null;
					return {repaired, file};
				},
			);

			expect(outcomes[0]).toEqual(outcomes[1]);
		}
	});
});
