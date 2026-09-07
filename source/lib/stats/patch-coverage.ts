// How much of the ticket's own code is exercised by tests.
//
// The mechanism that matters here is the anchoring. A coverage report's line
// numbers describe the tree the tests last ran against; a ticket's diff
// describes the tree at each of its commits. Match one against the other
// directly and any file that moved since — the ticket's own later commit,
// somebody else's, a reformat — silently reports the wrong lines, and a guard
// strict enough to prevent that throws away most tickets entirely.
//
// So the lines are anchored with `git blame` instead: blame HEAD, keep the
// lines whose commit is one of the ticket's, and read *those* line numbers
// against the report. Drift stops being a problem to defend against and
// becomes the thing blame is for. It also answers a question worth asking on
// its own — how much of what this ticket wrote is still standing.
//
// The cost of being honest about it: four states per line, not two. A line
// can be covered, uncovered, in an instrumented file but carrying no record
// of its own (a type, a brace, a blank), or in a file the report has never
// heard of. Only the first two are a percentage; the rest are the denominator
// a bare percentage would hide.

import {execGitAllowFail} from '../../git/git-utils.js';
import {CoverageReport} from './coverage-report.js';
import {isGeneratedPath} from './file-kinds.js';
import {FileCoverage, PatchCoverage} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

// Blame is one spawn per file. Past this a ticket is broad enough that the
// per-file table was never going to be read anyway.
const MAX_BLAMED_FILES = 100;

const BLAME_HEADER = /^([0-9a-f]{40}) \d+ (\d+)/;

const empty = (linesAdded: number, reason: string | null): PatchCoverage => ({
	report: null,
	anchored: reason === null,
	notAnchoredReason: reason,
	linesAdded,
	survivingLines: 0,
	truncated: false,
	covered: 0,
	uncovered: 0,
	notInstrumented: 0,
	notInReport: 0,
	files: [],
});

/**
 * Line numbers at HEAD whose blame lands on one of `shas`. Empty for a file
 * that is gone, binary, or that git refuses to blame — all of which are
 * "nothing of this ticket survives here", which is the truth.
 */
const readTicketLinesAtHead = async ({
	repoRoot,
	filePath,
	shas,
}: {
	repoRoot: string;
	filePath: string;
	shas: Set<string>;
}): Promise<number[]> => {
	const blame = await execGitAllowFail({
		cwd: repoRoot,
		args: ['blame', '--line-porcelain', 'HEAD', '--', filePath],
	});

	if (blame.exitCode !== 0) return [];

	const lines: number[] = [];

	for (const line of blame.stdout.split('\n')) {
		const match = BLAME_HEADER.exec(line);
		if (!match) continue;

		const [, sha = '', lineNumber = ''] = match;
		if (shas.has(sha)) lines.push(Number(lineNumber));
	}

	return lines;
};

const isInCheckout = async ({
	repoRoot,
	sha,
}: {
	repoRoot: string;
	sha: string;
}): Promise<boolean> => {
	const result = await execGitAllowFail({
		cwd: repoRoot,
		args: ['merge-base', '--is-ancestor', sha, 'HEAD'],
	});

	return result.exitCode === 0;
};

export const derivePatchCoverage = async ({
	repoRoot,
	patch,
	shas,
	lastCommitAt,
	report,
}: {
	repoRoot: string;
	patch: TicketPatch;
	shas: string[];
	lastCommitAt: number | null;
	report: CoverageReport | null;
}): Promise<PatchCoverage> => {
	const linesAdded = patch.insertions;

	const newest = shas[0];
	if (!newest) return empty(linesAdded, 'This ticket has no commits');

	// Blame only sees what the checkout contains. A ticket whose branch is not
	// checked out here would otherwise report every line of it as gone.
	if (!(await isInCheckout({repoRoot, sha: newest}))) {
		return empty(
			linesAdded,
			"This ticket's commits are not in the current checkout",
		);
	}

	const shaSet = new Set(shas);

	const blameable = patch.files.filter(
		file =>
			!file.binary && !isGeneratedPath(file.path) && file.status !== 'deleted',
	);

	const candidates = blameable.slice(0, MAX_BLAMED_FILES);

	const files: FileCoverage[] = [];

	let survivingLines = 0;
	let covered = 0;
	let uncovered = 0;
	let notInstrumented = 0;
	let notInReport = 0;

	for (const file of candidates) {
		const lines = await readTicketLinesAtHead({
			repoRoot,
			filePath: file.path,
			shas: shaSet,
		});

		survivingLines += lines.length;
		if (lines.length === 0) continue;

		const fileHits = report?.hitsByPath.get(file.path);

		if (!fileHits) {
			notInReport += lines.length;
			files.push({
				path: file.path,
				survivingLines: lines.length,
				covered: 0,
				uncovered: 0,
				notInstrumented: 0,
				inReport: false,
			});
			continue;
		}

		const entry: FileCoverage = {
			path: file.path,
			survivingLines: lines.length,
			covered: 0,
			uncovered: 0,
			notInstrumented: 0,
			inReport: true,
		};

		for (const line of lines) {
			const hits = fileHits.get(line);

			if (hits === undefined) {
				entry.notInstrumented++;
				continue;
			}

			if (hits > 0) entry.covered++;
			else entry.uncovered++;
		}

		covered += entry.covered;
		uncovered += entry.uncovered;
		notInstrumented += entry.notInstrumented;
		files.push(entry);
	}

	return {
		report: report
			? {
					path: report.path,
					modifiedAt: report.modifiedAt,
					totalLines: report.totalLines,
					totalCovered: report.totalCovered,
					olderThanLastCommit:
						lastCommitAt !== null && report.modifiedAt < lastCommitAt,
			  }
			: null,
		anchored: true,
		notAnchoredReason: null,
		linesAdded,
		survivingLines,
		// Everything below counts only the files blame actually ran over.
		truncated: candidates.length < blameable.length || patch.truncated,
		covered,
		uncovered,
		notInstrumented,
		notInReport,
		// Busiest first: the file with most of the ticket in it is the one a
		// reader wants the coverage of.
		files: files.sort((a, b) => b.survivingLines - a.survivingLines),
	};
};
