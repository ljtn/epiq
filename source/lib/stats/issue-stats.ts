// What one ticket's code says about itself.
//
// The flow, in one place: take the commits the ticket owns, read their patches
// in a single `git show`, read what the repository looked like just before the
// ticket started, and derive a section per question from those two reads.
// Every section is a pure function of the scan, so a new one is a new module
// here and a line below — never a third walk over git.

import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {deriveChangeShape} from './change-shape.js';
import {deriveCommentDensity} from './comment-density.js';
import {deriveFlags} from './flags.js';
import {IssueStats, StatsCommit} from './issue-stats.model.js';
import {deriveLanguages} from './languages.js';
import {scanTicketPatch} from './patch-scan.js';
import {readRepoBaseline} from './repo-baseline.js';
import {deriveTestSignal} from './test-signal.js';

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

	return succeeded('Derived issue stats', {
		ref,
		shape: deriveChangeShape({commits, patch}),
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
