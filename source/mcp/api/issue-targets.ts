import {Ticket, isTicketNode} from '../../lib/model/context.model.js';
import {
	isFail,
	failed,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {ApiBatchOutcome} from '../api-state.model.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {getStateResult} from './boot.js';

// One ticket or many. issueIds asks for a per-ticket outcome; issueId alone
// keeps the single answer.
export type IssueTargets = {
	issueId?: string;
	issueIds?: string[];
};

export const targetIds = (input: IssueTargets): Result<string[]> => {
	const ids = [
		...new Set([
			...(input.issueIds ?? []),
			...(input.issueId ? [input.issueId] : []),
		]),
	];

	return ids.length
		? succeeded('Resolved targets', ids)
		: failed('Provide issueId or issueIds');
};

export const batchResult = (
	verb: string,
	outcome: ApiBatchOutcome,
): Result<ApiBatchOutcome> => {
	const done = outcome.done.length;
	const summary =
		`${verb} ${done} issue${done === 1 ? '' : 's'}` +
		(outcome.failed.length ? `, ${outcome.failed.length} failed` : '');

	return done
		? succeeded(summary, outcome)
		: failed(
				`${summary}: ${outcome.failed
					.map(f => `${f.ref} ${f.reason}`)
					.join('; ')}`,
		  );
};

// Runs one write per target and sorts the outcomes. Each write persists on
// its own: a rank is resolved against the state the write before it left, so
// the saving is the round trip and the result in the caller's context, not
// the persist.
export const forEachTarget = (
	ids: string[],
	write: (id: string) => Result<unknown>,
): ApiBatchOutcome => {
	const outcome: ApiBatchOutcome = {done: [], failed: []};

	for (const id of ids) {
		const result = write(id);
		if (isFail(result)) {
			outcome.failed.push({id, ref: nodeRef(id), reason: result.message});
		} else {
			outcome.done.push({id, ref: nodeRef(id)});
		}
	}

	return outcome;
};

export const findWritableIssue = (id: string): Result<Ticket> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[id];
	if (!issue || issue.isDeleted) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Target must be an issue');
	if (issue.readonly) return failed('Issue is readonly');

	return succeeded('Found issue', issue);
};

export type IssueRef = {id: string; ref: string};
