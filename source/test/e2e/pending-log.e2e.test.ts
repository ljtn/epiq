/**
 * A write survives git resetting the log underneath it — deterministically.
 *
 * `write-during-sync.test.ts` in the collaboration suite covers the same
 * ground by racing a real writer against a real sync, and that is worth having:
 * it is the honest end-to-end shape. But it is a race, so it reports the bug
 * only when the writer happens to land inside git's window. It has passed while
 * the bug was present and failed while it was absent, which makes it useless
 * for proving either.
 *
 * The destructive step is not random, though. It is git resetting a tracked
 * file, and that can simply be done on demand. Everything here is exact: no
 * timing, no retries, no luck.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ensureStateBranchLayout} from '../../git/git-storage.js';
import {
	restoreDroppedEventLines,
	snapshotEventLogs,
} from '../../git/log-integrity.js';
import {isFail} from '../../lib/model/result-types.js';
import {
	flushPendingLogs,
	toPendingFileName,
} from '../../lib/event/pending-log.js';

const TRACKED = '01hzzactor.ana.jsonl';
const PENDING = toPendingFileName(TRACKED);

let repo: string;
let eventsDir: string;

const git = (...args: string[]) =>
	execFileSync('git', args, {cwd: repo, encoding: 'utf8'});

const eventLine = (id: string) =>
	`${JSON.stringify({v: 1, id: [id, null], 'issue.create': {title: id}})}\n`;

const linesOf = (name: string): string[] => {
	const filePath = path.join(eventsDir, name);
	if (!fs.existsSync(filePath)) return [];

	return fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter(line => line.trim().length > 0);
};

const idsIn = (name: string): string[] =>
	linesOf(name).map(line => (JSON.parse(line) as {id: [string]}).id[0]);

beforeEach(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-pending-e2e-'));
	eventsDir = path.join(repo, '.epiq', 'events');

	git('init', '-q');

	// The real layout, not a hand-rolled one: the merge attribute and the
	// ignore rule that keeps a pending log untrackable are part of what is
	// under test, and a test that wrote its own copy would pass while the
	// product's version was wrong.
	const layout = ensureStateBranchLayout(repo, repo);
	if (isFail(layout)) throw new Error(layout.message);

	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'test');

	// The tracked log, committed — this is the file git owns and resets.
	fs.writeFileSync(path.join(eventsDir, TRACKED), eventLine('committed'));
	git('add', '-A');
	git('commit', '-q', '-m', 'the log so far');
});

afterEach(() => {
	fs.rmSync(repo, {recursive: true, force: true});
});

describe('a write while git holds the worktree', () => {
	// The bug, stated exactly. `git checkout -- .` is what a rebase's stash and
	// checkout, and what `rebase --abort`, do to a tracked file: they put back
	// the committed content and discard whatever was written since.
	it('is destroyed when it went into the tracked log', () => {
		fs.appendFileSync(path.join(eventsDir, TRACKED), eventLine('written'));
		expect(idsIn(TRACKED)).toEqual(['committed', 'written']);

		git('checkout', '--', '.');

		// This is the data loss, reproduced without any race at all.
		expect(idsIn(TRACKED)).toEqual(['committed']);
	});

	it('survives when it went into the pending log', () => {
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		git('checkout', '--', '.');

		expect(idsIn(PENDING)).toEqual(['written']);
	});

	// `rebase --abort` is the harsher one: it resets rather than checks out.
	it('survives a hard reset', () => {
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		git('reset', '--hard', '-q', 'HEAD');

		expect(idsIn(PENDING)).toEqual(['written']);
	});

	// The autostash half of a rebase: stash the working copy, put it back.
	it('survives a stash round trip', () => {
		fs.appendFileSync(path.join(eventsDir, TRACKED), eventLine('dirty'));
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		git('stash', 'push', '-q', '-m', 'autostash');
		git('stash', 'pop', '-q');

		expect(idsIn(PENDING)).toEqual(['written']);
	});

	it('is folded into the tracked log once git is done', () => {
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		git('checkout', '--', '.');
		flushPendingLogs(repo, TRACKED);

		expect(idsIn(TRACKED)).toEqual(['committed', 'written']);
		expect(fs.existsSync(path.join(eventsDir, PENDING))).toBe(false);
	});

	// The snapshot exists to put back lines git dropped. A pending log is not
	// something git can drop, and a sync deliberately consumes one — so if the
	// snapshot covered it, the restore would read the flush as loss and put the
	// file back. The lines would then sit in both, and every later sync would
	// append them again.
	it('is not resurrected by the integrity snapshot after a flush', () => {
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		const snapshot = snapshotEventLogs(repo);
		flushPendingLogs(repo, TRACKED);
		const restored = restoreDroppedEventLines(repo, snapshot);

		expect(restored).toEqual([]);
		expect(fs.existsSync(path.join(eventsDir, PENDING))).toBe(false);
		expect(idsIn(TRACKED)).toEqual(['committed', 'written']);
	});

	// The other half: a line the *tracked* log lost is still put back, so
	// excluding pending files has not blunted the net.
	it('still restores a line git dropped from the tracked log', () => {
		fs.appendFileSync(path.join(eventsDir, TRACKED), eventLine('at-risk'));

		const snapshot = snapshotEventLogs(repo);
		git('checkout', '--', '.');
		const restored = restoreDroppedEventLines(repo, snapshot);

		// Reported as `<name> (<lines put back>)`.
		expect(restored).toEqual([`${TRACKED} (1)`]);
		expect(idsIn(TRACKED)).toEqual(['committed', 'at-risk']);
	});

	// The pending file must never be committed, or it stops being untracked and
	// the whole scheme quietly reverts to the broken one.
	it('is not something `git add -A` picks up', () => {
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('written'));

		git('add', '-A');

		expect(git('diff', '--cached', '--name-only')).not.toContain(PENDING);
	});
});

// The sync's order is snapshot (pending excluded), flush, stage the own file,
// commit, hand the worktree to git, restore. Another actor sharing the worktree
// has lines in their pending log throughout; they are committed by nobody here.
// Folding them would put them in a tracked file with nothing behind them —
// leaving them pending is what keeps them.
describe("another actor's pending log during someone else's sync", () => {
	const OTHER = '01hzzother.bo.jsonl';

	it('survives the whole sequence untouched', () => {
		fs.writeFileSync(path.join(eventsDir, OTHER), eventLine('bo-committed'));
		git('add', '-A');
		git('commit', '-q', '-m', 'both logs');

		fs.appendFileSync(
			path.join(eventsDir, toPendingFileName(OTHER)),
			eventLine('bo-written'),
		);
		fs.appendFileSync(path.join(eventsDir, PENDING), eventLine('ana-written'));

		const snapshot = snapshotEventLogs(repo);
		flushPendingLogs(repo, TRACKED);
		git('add', '--', `.epiq/events/${TRACKED}`);
		git('commit', '-q', '-m', 'ana sync');
		git('checkout', '--', '.');
		restoreDroppedEventLines(repo, snapshot);

		expect(idsIn(TRACKED)).toEqual(['committed', 'ana-written']);
		expect(idsIn(OTHER)).toEqual(['bo-committed']);
		expect(idsIn(toPendingFileName(OTHER))).toEqual(['bo-written']);
	});
});
