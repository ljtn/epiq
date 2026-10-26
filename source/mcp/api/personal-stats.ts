// The viewer's own totals, for the identity panel: tickets and comments from
// the log (as of a scrub), commits from the repository-wide author scan.

import {getStateBranch} from '../../git/git-constants.js';
import {readGitName} from '../../lib/config/git-identity.js';
import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {findEmailCandidates} from '../../lib/repository/email-candidates.js';
import {PersonalStats} from '../../lib/stats/personal-stats.model.js';
import {authoredTotals} from '../../lib/stats/personal-stats.js';
import {ToolInput, bootedWithActorAndState} from './boot.js';

export const getPersonalStats = async (
	input: ToolInput = {},
): Promise<Result<PersonalStats>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const {userId, userName} = ready.value.actor;
	const totals = authoredTotals(ready.value.state.eventLog, userId);

	const branchResult = getStateBranch(ready.value.boot.repoRoot);

	const scanned = await findEmailCandidates({
		repoRoot: ready.value.boot.repoRoot,
		stateBranch: isFail(branchResult) ? undefined : branchResult.value,
		names: [userName, await readGitName(ready.value.boot.repoRoot)],
		links: ready.value.state.emailLinks,
	});

	// An unreadable history costs only the commit figure. A contested address
	// counts for nobody, as everywhere else.
	const mine = isFail(scanned)
		? []
		: scanned.value.filter(
				candidate =>
					candidate.claimedBy.length === 1 && candidate.claimedBy[0] === userId,
		  );

	return succeeded('Derived personal stats', {
		...totals,
		scanned: !isFail(scanned),
		commits: mine.reduce((total, candidate) => total + candidate.commits, 0),
		claimedEmails: mine.length,
	});
};
