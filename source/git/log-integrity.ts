import fs from 'node:fs';
import path from 'node:path';
import {execGitAllowFail} from './git-utils.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {EPIQ_DIR_NAME, EVENTS_DIR_NAME} from '../lib/storage/paths.js';

/**
 * The event log is append-only. That is not a style preference — it is what
 * makes `*.jsonl merge=union` safe, what lets an id mean one byte sequence
 * forever, and what every replica's convergence rests on.
 *
 * Nothing enforced it. `createStateBranchSyncCommit` committed the log exactly
 * as it sat on disk, so any process that emptied or replaced the working copy
 * had its damage committed and pushed on the next autosync, and every clone
 * that pulled lost the same history. It has happened: a 2158-line log went to
 * one line, and twice before that a handful of lines went missing unnoticed.
 *
 * A working copy is allowed to gain lines and reorder nothing. Losing even one
 * means the file on disk is damaged, and the last thing to do with a damaged
 * log is publish it.
 */

const linesIn = (content: string): string[] =>
	content.split('\n').filter(line => line.trim().length > 0);

/**
 * Event logs sitting in a directory that is about to be deleted wholesale.
 * Non-empty ones only: an empty file is nothing to save, and refusing over one
 * would strand the very cleanup that unblocks the user.
 */
export const findStrandedEventLogs = (root: string): Result<string[]> => {
	const dir = path.join(root, EPIQ_DIR_NAME, EVENTS_DIR_NAME);

	try {
		if (!fs.existsSync(dir)) return succeeded('No events directory', []);

		const stranded = fs
			.readdirSync(dir)
			.filter(name => name.endsWith('.jsonl'))
			.filter(
				name =>
					linesIn(fs.readFileSync(path.join(dir, name), 'utf8')).length > 0,
			);

		return succeeded('Looked for stranded event logs', stranded);
	} catch (error) {
		// Unreadable is not "safe to delete".
		return failed(
			`Unable to check ${dir} for event logs before deleting it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};

export type EventLogSnapshot = ReadonlyMap<string, string[]>;

const eventsDirIn = (root: string): string =>
	path.join(root, EPIQ_DIR_NAME, EVENTS_DIR_NAME);

/**
 * Every event log line on disk right now, per file.
 *
 * Paired with `restoreDroppedEventLines` around anything that hands the
 * worktree to git. `withSyncLock` binds the processes that *sync*; nothing
 * binds the processes that *write*, so while one process rebases, another may
 * be appending to and reading from the directory git is rewriting.
 * `rebase.autoStash` widens that window — it reverts the working copy to HEAD
 * and puts it back afterwards — and an interrupted rebase widens it further,
 * since the next process recovers with `git rebase --abort`, which resets the
 * working tree over anything written in between.
 *
 * Snapshotting is not a lock. It is the weaker guarantee that whatever was
 * already on disk is still on disk when git is done, which is the same rule
 * `assertLogOnlyGrew` enforces at the commit boundary: a log may gain lines
 * and reorder nothing.
 */
export const snapshotEventLogs = (root: string): EventLogSnapshot => {
	const dir = eventsDirIn(root);
	const snapshot = new Map<string, string[]>();

	try {
		if (!fs.existsSync(dir)) return snapshot;

		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith('.jsonl')) continue;

			snapshot.set(
				name,
				linesIn(fs.readFileSync(path.join(dir, name), 'utf8')),
			);
		}
	} catch {
		// Best effort by design: this is a safety net over git, and failing the
		// sync because the net could not be strung would be the worse outcome.
		return snapshot;
	}

	return snapshot;
};

/**
 * Puts back any line the snapshot had that the file no longer does.
 *
 * Append-only makes this always safe: an id means one byte sequence forever,
 * `getSortedEvents` dedupes by id, and file order is not load-bearing — so
 * re-appending a line that is already there costs nothing and re-appending one
 * git dropped restores an event that had no other copy.
 *
 * Returns the files it repaired, for the caller to report.
 */
export const restoreDroppedEventLines = (
	root: string,
	snapshot: EventLogSnapshot,
): string[] => {
	if (snapshot.size === 0) return [];

	const dir = eventsDirIn(root);
	const repaired: string[] = [];

	for (const [name, lines] of snapshot) {
		if (lines.length === 0) continue;

		const filePath = path.join(dir, name);

		try {
			const present = new Set(
				fs.existsSync(filePath)
					? linesIn(fs.readFileSync(filePath, 'utf8'))
					: [],
			);

			const dropped = lines.filter(line => !present.has(line));
			if (dropped.length === 0) continue;

			fs.mkdirSync(dir, {recursive: true});

			// A file git truncated may have no trailing newline, and splicing a
			// line onto a partial one would corrupt both.
			const needsNewline =
				fs.existsSync(filePath) &&
				fs.readFileSync(filePath, 'utf8').replace(/\n$/, '').length > 0 &&
				!fs.readFileSync(filePath, 'utf8').endsWith('\n');

			fs.appendFileSync(
				filePath,
				`${needsNewline ? '\n' : ''}${dropped.join('\n')}\n`,
				'utf8',
			);

			repaired.push(`${name} (${dropped.length})`);
		} catch {
			// Same reasoning as above: a net that cannot be checked is not a
			// reason to fail the operation it was watching.
			continue;
		}
	}

	return repaired;
};

/** Lines present in `committed` that `working` no longer has. */
export const findDroppedLines = (
	committed: string,
	working: string,
): string[] => {
	const present = new Set(linesIn(working));

	return linesIn(committed).filter(line => !present.has(line));
};

export const describeDroppedLines = (
	relativePath: string,
	dropped: string[],
	committedCount: number,
): string =>
	[
		`Refusing to commit ${relativePath}: it is missing ${dropped.length} of ` +
			`the ${committedCount} event(s) already committed.`,
		'',
		'The event log is append-only, so a line can never legitimately go',
		'missing. The working copy on disk is damaged; committing it would',
		'publish that damage to everyone who pulls, and the log carries no way',
		'to undo it.',
		'',
		'Nothing has been committed. The committed history is intact — recover',
		'the file from it before syncing again:',
		`  git show HEAD:${relativePath}`,
		'',
		'First dropped event:',
		`  ${dropped[0]?.slice(0, 200) ?? '<none>'}`,
	].join('\n');

/**
 * Compares the working copy of one event log against the version already
 * committed. `allowFail` because the file legitimately has no committed
 * version on a first sync, and a missing path is not an integrity problem.
 */
export const assertLogOnlyGrew = async ({
	stateBranchRoot,
	relativePath,
	workingContent,
}: {
	stateBranchRoot: string;
	relativePath: string;
	workingContent: string;
}): Promise<Result<void>> => {
	const committed = await execGitAllowFail({
		args: ['show', `HEAD:${relativePath}`],
		cwd: stateBranchRoot,
	});

	// No committed version yet, or no HEAD at all: nothing to have lost.
	if (committed.exitCode !== 0) {
		return succeeded('No committed log to compare against', undefined);
	}

	const dropped = findDroppedLines(committed.stdout, workingContent);

	if (dropped.length > 0) {
		return failed(
			describeDroppedLines(
				relativePath,
				dropped,
				linesIn(committed.stdout).length,
			),
		);
	}

	return succeeded('Event log only grew', undefined);
};
