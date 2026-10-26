import fs from 'node:fs';
import path from 'node:path';
import {execGitAllowFail} from './git-utils.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {isPendingFileName} from '../lib/event/pending-log.js';
import {isVanished} from '../lib/event/log-signature.js';
import {EPIQ_DIR_NAME, EVENTS_DIR_NAME} from '../lib/storage/paths.js';

/**
 * The event log is append-only: a working copy may gain lines, never lose or
 * reorder one. A log that did is damaged and must not be committed.
 */

const linesIn = (content: string): string[] =>
	content.split('\n').filter(line => line.trim().length > 0);

/** Non-empty event logs in a directory about to be deleted wholesale. */
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
 * Every event log line on disk, per file. `restoreDroppedEventLines` puts back any
 * line git's rewrites drop, since writers hold no lock.
 */
export const snapshotEventLogs = (root: string): EventLogSnapshot => {
	const dir = eventsDirIn(root);
	const snapshot = new Map<string, string[]>();

	try {
		if (!fs.existsSync(dir)) return snapshot;

		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith('.jsonl')) continue;

			// Pending logs are skipped: a sync folds and deletes one, which a restore
			// would undo, duplicating its lines every sync.
			if (isPendingFileName(name)) continue;

			try {
				snapshot.set(
					name,
					linesIn(fs.readFileSync(path.join(dir, name), 'utf8')),
				);
			} catch (error) {
				// Gone since the listing: nothing of it to protect, and the rest
				// of the logs still deserve the net.
				if (!isVanished(error)) throw error;
			}
		}
	} catch {
		// Best effort by design: this is a safety net over git, and failing the
		// sync because the net could not be strung would be the worse outcome.
		return snapshot;
	}

	return snapshot;
};

/** A line worth putting back: one that parses, so it carries an id. */
const isRestorable = (line: string): boolean => {
	try {
		const parsed: unknown = JSON.parse(line);
		return typeof parsed === 'object' && parsed !== null;
	} catch {
		return false;
	}
};

/**
 * Re-appends any line the snapshot had that the file lost; safe since events
 * dedupe by id and file order is not load-bearing. Returns the repaired files.
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
			const content = fs.existsSync(filePath)
				? fs.readFileSync(filePath, 'utf8')
				: null;

			const present = new Set(content === null ? [] : linesIn(content));

			const dropped = lines
				.filter(line => !present.has(line))
				.filter(isRestorable);

			if (dropped.length === 0) continue;

			fs.mkdirSync(dir, {recursive: true});

			// A file git truncated may have no trailing newline, and splicing a
			// line onto a partial one would corrupt both.
			const needsNewline =
				content !== null && content.length > 0 && !content.endsWith('\n');

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

/** Compares one event log against its committed version, which a first sync lacks. */
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
