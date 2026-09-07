// What one ticket's code says about itself.
//
// The flow, in one place: take the commits the ticket owns, read their patches
// in a single `git show`, read what the repository looked like just before the
// ticket started, and derive a section per question from those two reads.
// Every section is a pure function of the scan, so a new one is a new module
// here and a line below — never a third walk over git.

import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {ChangeShape, deriveChangeShape, StatsCommit} from './change-shape.js';
import {CommentDensity, deriveCommentDensity} from './comment-density.js';
import {discoverCoverageReport} from './coverage-report.js';
import {ChangeFlags, deriveFlags} from './flags.js';
import {deriveLanguages, LanguageBreakdown} from './languages.js';
import {derivePatchCoverage, PatchCoverage} from './patch-coverage.js';
import {scanTicketPatch} from './patch-scan.js';
import {readRepoBaseline} from './repo-baseline.js';
import {deriveTestSignal, TestSignal} from './test-signal.js';

export type IssueStats = {
	ref: string;
	shape: ChangeShape;
	languages: LanguageBreakdown;
	tests: TestSignal;
	comments: CommentDensity;
	flags: ChangeFlags;
	coverage: PatchCoverage;
};

const oldestSha = (commits: StatsCommit[]): string | null =>
	commits.reduce<StatsCommit | null>(
		(oldest, commit) =>
			oldest === null || commit.time < oldest.time ? commit : oldest,
		null,
	)?.sha ?? null;

export const deriveIssueStats = async ({
	repoRoot,
	ref,
	commits,
}: {
	repoRoot: string;
	ref: string;
	commits: StatsCommit[];
}): Promise<Result<IssueStats>> => {
	const patchResult = await scanTicketPatch({
		repoRoot,
		shas: commits.map(commit => commit.sha),
	});

	if (isFail(patchResult)) return failed(patchResult.message);
	const patch = patchResult.value;

	const first = oldestSha(commits);
	const baseline = first
		? await readRepoBaseline({repoRoot, sha: first})
		: null;

	const shape = deriveChangeShape({commits, patch});

	const coverage = await derivePatchCoverage({
		repoRoot,
		patch,
		// Newest first, which is both the order getCommitsForRef answers in
		// and the one "is this ticket in this checkout at all" is asked in.
		shas: [...commits]
			.sort((a, b) => b.time - a.time)
			.map(commit => commit.sha),
		lastCommitAt: shape.lastCommitAt,
		report: discoverCoverageReport(repoRoot),
	});

	return succeeded('Derived issue stats', {
		ref,
		shape,
		coverage,
		languages: deriveLanguages({
			patch,
			languagesBefore: baseline?.languages ?? null,
		}),
		tests: deriveTestSignal({patch}),
		comments: deriveCommentDensity({
			patch,
			repoShareByLanguage: baseline?.commentShareByLanguage ?? null,
		}),
		flags: deriveFlags({patch}),
	});
};
