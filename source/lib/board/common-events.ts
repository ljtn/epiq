import {monotonicFactory, ulid} from 'ulid';
import {Result, succeeded} from '../model/result-types.js';
import {User} from '../state/settings.state.js';
import {AppEvent} from './board-events.model.js';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parent,
	rank,
	user: {userId},
}: {
	name: string;
	parent: string;
	rank: string;
	user: User;
}): Result<readonly AppEvent[]> => {
	const issueId = nextId();

	return succeeded('Created issue events', [
		{
			id: ulid(),
			userId,
			action: 'add.issue',
			payload: {
				id: issueId,
				parent,
				name,
				rank,
			},
		},
	] satisfies readonly AppEvent[]);
};
