import {monotonicFactory, ulid} from 'ulid';
import {AppEvent} from './event.model.js';
import {User} from '../state/settings.state.js';
import {midRank, rankBetween} from '../utils/rank.js';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parent,
	rank,
	user: {userId, userName},
}: {
	name: string;
	parent: string;
	rank: string;
	user: User;
}): readonly AppEvent[] => {
	const issueId = nextId();
	const descriptionId = nextId();
	const assigneesId = nextId();
	const tagsId = nextId();

	const descriptionRank = midRank();
	const assigneesRank = rankBetween(descriptionRank, undefined);
	const tagsRank = rankBetween(assigneesRank, undefined);

	return [
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.issue',
			payload: {
				id: issueId,
				parent,
				name,
				rank,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: descriptionId,
				parent: issueId,
				name: 'Description',
				val: '',
				rank: descriptionRank,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: assigneesId,
				parent: issueId,
				name: 'Assignees',
				rank: assigneesRank,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: tagsId,
				parent: issueId,
				name: 'Tags',
				rank: tagsRank,
			},
		},
	] satisfies readonly AppEvent[];
};
