// The viewer's own totals, for the identity panel.
//
// Two halves, from two places. Tickets, comments and how long they have been
// here are counted off the event log — `authoredTotals` does that and nothing
// else. Commits are not events, so they come from the same author scan the
// panel already runs for its Unclaimed list: cached for a few seconds, and
// already excluding the state branch, so the board writing its own log is not
// mistaken for somebody's work.
//
// While the timeline is scrubbed the first half is as of that moment — the
// log holds only what has been applied — and the commit figure is not, being
// repository-wide. The same bargain `diff-stats:get` strikes, and for the same
// reason: a ticket's commits are what it has come to, not what a window holds.

import {getStateBranch} from '../../git/git-constants.js';
import {readGitName} from '../../lib/config/git-identity.js';
import {isFail, Result, succeeded} from '../../lib/model/result-types.js';
import {findEmailCandidates} from '../../lib/repository/email-candidates.js';
import {PersonalStats} from '../../lib/stats/personal-stats.model.js';
import {authoredTotals} from '../../lib/stats/personal-stats.js';
import {ToolInput, boot, getActor, getStateResult} from './boot.js';

export const getPersonalStats = async (
	input: ToolInput = {},
): Promise<Result<PersonalStats>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const {userId, userName} = actorResult.value;
	const totals = authoredTotals(stateResult.value.eventLog, userId);

	const branchResult = getStateBranch(bootResult.value.repoRoot);

	const scanned = await findEmailCandidates({
		repoRoot: bootResult.value.repoRoot,
		stateBranch: isFail(branchResult) ? undefined : branchResult.value,
		names: [userName, await readGitName(bootResult.value.repoRoot)],
		links: stateResult.value.emailLinks,
	});

	// A history that could not be read costs the commit figure, not the panel.
	// The three counted off the log are still true, and the addresses below
	// them carry their own scan error already.
	//
	// A contested address counts for nobody, here as everywhere else. Two
	// people claiming one address is the state `emailOwnerIndex` resolves to
	// neither of them, and the panel says so a few rows below this figure —
	// crediting both of them here would have the same surface making both
	// claims at once.
	const mine = isFail(scanned)
		? []
		: scanned.value.filter(
				candidate =>
					candidate.claimedBy.length === 1 && candidate.claimedBy[0] === userId,
		  );

	return succeeded('Derived personal stats', {
		...totals,
		commits: mine.reduce((total, candidate) => total + candidate.commits, 0),
		claimedEmails: mine.length,
	});
};
