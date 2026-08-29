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
