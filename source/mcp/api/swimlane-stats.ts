// A lane's own numbers: when it opened, its traffic, and its tickets' code.
// Fetched on a click, as the code half goes to git.

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

// Caps how many tickets' code is measured; the flow figures cost no git.
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

		// No commits or a failed scan skips the ticket without losing the rest.
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

	// Every ticket: a lane's traffic is mostly tickets that have left it.
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
