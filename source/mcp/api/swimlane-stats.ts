// A lane's own numbers: when it was opened, what its traffic looks like, and
// what the code on the tickets standing in it adds up to.
//
// The traffic half reads the materialized state, like `getIssueHistory` does,
// so it stays correct mid-scrub. The code half goes to git through
// `getIssueStats`, which is why the whole thing is fetched on a click rather
// than ridden along on the board broadcast.

import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {isTicketNode} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {deriveLaneFlow} from '../../lib/stats/swimlane-flow.js';
import {deriveLaneStayTrend} from '../../lib/stats/lane-trend.js';
import {
	SwimlaneCode,
	SwimlaneStats,
} from '../../lib/stats/swimlane-stats.model.js';
import {laneVisits} from '../../lib/utils/lane-dwell.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {getIssueStats} from '../epiq-issue-stats.js';
import {getStateResult} from './boot.js';

// A lane can hold a great many tickets, and each one measured is a walk over
// its patches. Past this the code figures say what they saw and stop, which is
// a slow panel avoided rather than a number missed: the flow figures above
// them are the point of the panel and cost no git at all.
const CODE_TICKET_LIMIT = 40;

// Long enough for a slope to be a slope rather than a wobble, short enough that
// a lane opened last week still draws something.
const TREND_DAYS = 30;

const emptyCode = (): SwimlaneCode => ({
	tickets: 0,
	commits: 0,
	insertions: 0,
	deletions: 0,
});

const codeForLane = async (
	repoRoot: string,
	ticketIds: readonly string[],
): Promise<SwimlaneCode> => {
	const code = emptyCode();

	for (const id of ticketIds.slice(0, CODE_TICKET_LIMIT)) {
		const stats = await getIssueStats({repoRoot, idOrRef: nodeRef(id)});

		// A ticket with no commits is not a failure, and neither is one whose
		// scan could not run — either way the lane's total is over what could
		// be measured, and one unreadable ticket must not lose the rest.
		if (isFail(stats) || stats.value.shape.commits === 0) continue;

		code.tickets++;
		code.commits += stats.value.shape.commits;
		code.insertions += stats.value.shape.insertions;
		code.deletions += stats.value.shape.deletions;
	}

	return code;
};

export const getSwimlaneStats = async (input: {
	repoRoot: string;
	swimlaneId: string;
}): Promise<Result<SwimlaneStats>> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const {nodes} = stateResult.value;

	const swimlane = nodes[input.swimlaneId];
	if (!swimlane) return failed('Swimlane not found');

	const tickets = Object.values(nodes).filter(isTicketNode);

	// Every ticket on the workspace, not just the ones standing here: a lane's
	// traffic is mostly a fact about tickets that have already left it, and so
	// is what its stay looked like a month ago.
	const journeys = tickets.map(ticket =>
		laneVisits(ticket.log ?? [], ulidTimeMs(ticket.id)),
	);

	const flow = deriveLaneFlow(
		input.swimlaneId,
		journeys.map(visits => visits.map(visit => visit.laneId)),
		laneId => nodes[laneId]?.title ?? 'Elsewhere',
	);

	const standingHere = tickets
		.filter(ticket => ticket.parentNodeId === input.swimlaneId)
		.map(ticket => ticket.id);

	return succeeded('Derived swimlane stats', {
		swimlaneId: input.swimlaneId,
		createdAt: ulidTimeMs(input.swimlaneId),
		...flow,
		stayTrend: deriveLaneStayTrend({
			laneId: input.swimlaneId,
			journeys,
			now: Date.now(),
			days: TREND_DAYS,
		}),
		code: await codeForLane(input.repoRoot, standingHere),
	});
};
