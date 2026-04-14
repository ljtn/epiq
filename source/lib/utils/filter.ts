import {nodeRepo} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {Filter} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getState} from '../state/state.js';

export type FilterField = 'all' | 'title' | 'description' | 'tag' | 'assignee';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const getFieldStringValue = (ticketId: string, fieldTitle: string): string => {
	const field = nodeRepo.getFieldByTitle(ticketId, fieldTitle);
	if (!field) return '';

	const value = field.props?.value;
	return typeof value === 'string' ? value : '';
};

const getTagNames = (ticketId: string): string[] => {
	const {tags} = getState();
	const tagsField = nodeRepo.getFieldByTitle(ticketId, 'Tags');
	if (!tagsField) return [];

	return getOrderedChildren(tagsField.id)
		.map(child => {
			const tagId = child.props?.value;
			return typeof tagId === 'string' ? tags[tagId]?.name : undefined;
		})
		.filter((name): name is string => Boolean(name));
};

const getAssigneeNames = (ticketId: string): string[] => {
	const {contributors} = getState();
	const assigneesField = nodeRepo.getFieldByTitle(ticketId, 'Assignees');
	if (!assigneesField) return [];

	return getOrderedChildren(assigneesField.id)
		.map(child => {
			const contributorId = child.props?.value;
			return typeof contributorId === 'string'
				? contributors[contributorId]?.name
				: undefined;
		})
		.filter((name): name is string => Boolean(name));
};

export const ticketMatchesFilter = (
	ticket: NavNode<'TICKET'>,
	filter: Filter,
): boolean => {
	const query = filter.value;
	if (!query) return true;

	switch (filter.target) {
		case 'title':
			const title = normalize(ticket.title ?? '');
			return title.includes(query);

		case 'description':
			const description = normalize(
				getFieldStringValue(ticket.id, 'Description'),
			);
			return description.includes(query);

		case 'tag':
			const tagNames = getTagNames(ticket.id).map(normalize);
			return tagNames.some(tag => tag.includes(query));

		case 'assignee':
			const assigneeNames = getAssigneeNames(ticket.id).map(normalize);
			return assigneeNames.some(name => name.includes(query));

		default:
			return true;
	}
};
