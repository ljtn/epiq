import {monotonicFactory} from 'ulid';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parentId,
}: {
	name: string;
	parentId: string;
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
				name,
				parentId,
			},
		},
		{
			action: 'add.field',
			payload: {
				id: descriptionId,
				name: 'Description',
				parentId: issueId,
				value: '',
			},
		},
		{
			action: 'add.field',
			payload: {
				id: assigneesId,
				name: 'Assignees',
				parentId: issueId,
			},
		},
		{
			action: 'add.field',
			payload: {
				id: tagsId,
				name: 'Tags',
				parentId: issueId,
			},
		},
	] as const;
};
