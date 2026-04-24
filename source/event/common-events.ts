import {monotonicFactory, ulid} from 'ulid';
import {AppEvent, UserId, UserName} from './event.model.js';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parent,
	userId,
	userName,
}: {
	name: string;
	parent: string;
	userId: UserId;
	userName: UserName;
}): readonly AppEvent[] => {
	const issueId = nextId();
	const descriptionId = nextId();
	const assigneesId = nextId();
	const tagsId = nextId();

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
			},
		},
	] satisfies readonly AppEvent[];
};
