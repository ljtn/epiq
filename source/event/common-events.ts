import {monotonicFactory} from 'ulid';
import {AppEvent} from './event.model.js';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parent,
}: {
	name: string;
	parent: string;
}) => {
	const issueId = nextId();
	const descriptionId = nextId();
	const assigneesId = nextId();
	const tagsId = nextId();

	return [
		{
			action: 'add.issue',
			payload: {
				id: issueId,
				parent,
				name,
			},
		},
		{
			action: 'add.field',
			payload: {
				id: descriptionId,
				parent: issueId,
				name: 'Description',
				val: '',
			},
		},
		{
			action: 'add.field',
			payload: {
				id: assigneesId,
				parent: issueId,
				name: 'Assignees',
			},
		},
		{
			action: 'add.field',
			payload: {
				id: tagsId,
				parent: issueId,
				name: 'Tags',
			},
		},
	] satisfies AppEvent[];
};
