// What one ticket's code says about itself.
//
// The flow, in one place: take the commits the ticket owns, read their patches
// in a single `git show`, and derive a section per question from that one scan.
// Every section is a pure function of the scan, so a new one is a new module
// here and a line below — never a second walk over git.

import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {ChangeShape, deriveChangeShape, StatsCommit} from './change-shape.js';
import {scanTicketPatch} from './patch-scan.js';

export type IssueStats = {
	ref: string;
	shape: ChangeShape;
};

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

	return succeeded('Derived issue stats', {
		ref,
		shape: deriveChangeShape({commits, patch: patchResult.value}),
	});
};
