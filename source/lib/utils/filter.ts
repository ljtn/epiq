import {Filter} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getState} from '../state/state.js';

export type FilterField = 'all' | 'title' | 'description' | 'tag' | 'assignee';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const getTagNames = (ticket: NavNode<'TICKET'>): string[] => {
	const {tags} = getState();

	return (ticket.props.tags ?? [])
		.map(tag => tags[tag]?.name)
		.filter((name): name is string => Boolean(name));
};

const getAssigneeNames = (ticket: NavNode<'TICKET'>): string[] => {
	const {contributors} = getState();

	return (ticket.props.assignees ?? [])
		.map(assignee => contributors[assignee]?.name)
		.filter((name): name is string => Boolean(name));
};

export const ticketMatchesFilter = (
	ticket: NavNode<'TICKET'>,
	filter: Filter,
): boolean => {
	const query = normalize(filter.value);
	if (!query) return true;

	switch (filter.target) {
		case 'title': {
			const title = normalize(ticket.title ?? '');
			return title.includes(query);
		}

		case 'description': {
			const description = normalize(ticket.props.description ?? '');
			return description.includes(query);
		}

		case 'tag': {
			const tagNames = getTagNames(ticket).map(normalize);
			return tagNames.some(tag => tag.includes(query));
		}

		case 'assignee': {
			const assigneeNames = getAssigneeNames(ticket).map(normalize);
			return assigneeNames.some(name => name.includes(query));
		}

		// case 'all': {
		// 	const title = normalize(ticket.title ?? '');
		// 	const description = normalize(ticket.props.description ?? '');
		// 	const tagNames = getTagNames(ticket).map(normalize);
		// 	const assigneeNames = getAssigneeNames(ticket).map(normalize);

		// 	return (
		// 		title.includes(query) ||
		// 		description.includes(query) ||
		// 		tagNames.some(tag => tag.includes(query)) ||
		// 		assigneeNames.some(name => name.includes(query))
		// 	);
		// }

		default:
			return true;
	}
};
