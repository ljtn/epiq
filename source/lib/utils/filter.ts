import {Filter, Tag} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getState} from '../state/state.js';
import {nodeRefMatches} from './node-ref.js';
import {normalizeText, textIncludes} from './text-match.js';

export type FilterField =
	| 'all'
	| 'title'
	| 'description'
	| 'tag'
	| 'assignee'
	| 'ref';

const getTagNames = (ticket: NavNode<'TICKET'>): string[] => {
	const {tags} = getState();

	return (ticket.props.tags ?? [])
		.map(tag => tags[tag])
		.filter((tag): tag is Tag => tag !== undefined && !tag.tombstoned)
		.map(tag => tag.name);
};

const getAssigneeNames = (ticket: NavNode<'TICKET'>): string[] => {
	const {contributors} = getState();

	return (ticket.props.assignees ?? [])
		.map(assignee => {
			const contributor = contributors[assignee];
			return contributor ? contributor.name : undefined;
		})
		.filter((name): name is string => Boolean(name));
};

export const ticketMatchesFilter = (
	ticket: NavNode<'TICKET'>,
	filter: Filter,
): boolean => {
	const query = normalizeText(filter.value);
	if (!query) return true;

	switch (filter.target) {
		case 'title':
			return textIncludes(ticket.title ?? '', query);

		case 'description':
			return textIncludes(ticket.props.description ?? '', query);

		case 'tag': {
			const tagNames = getTagNames(ticket).map(normalizeText);
			return tagNames.some(tag => tag.includes(query));
		}

		case 'assignee': {
			const assigneeNames = getAssigneeNames(ticket).map(normalizeText);
			return assigneeNames.some(name => name.includes(query));
		}

		case 'ref': {
			return nodeRefMatches(ticket.id, filter.value);
		}

		// case 'all': {
		// 	const title = normalizeText(ticket.title ?? '');
		// 	const description = normalizeText(ticket.props.description ?? '');
		// 	const tagNames = getTagNames(ticket).map(normalizeText);
		// 	const assigneeNames = getAssigneeNames(ticket).map(normalizeText);

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
