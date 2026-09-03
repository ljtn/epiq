import {AppEvent} from '../event/event.model.js';
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
	| 'actor'
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

/**
 * Who has worked each node, from the log rather than from the node: authorship
 * is not materialized onto nodes, and does not need to be — every event already
 * carries the actor it was written by.
 *
 * Rebuilt only when the log is replaced, because a filter is re-evaluated per
 * ticket on every keystroke and the log is the longest thing in state.
 */
let indexedLog: AppEvent[] | null = null;
let actorsByNode = new Map<string, Set<string>>();

const getActorsByNode = (): Map<string, Set<string>> => {
	const eventLog = getState().eventLog ?? [];

	if (eventLog === indexedLog) return actorsByNode;

	const byNode = new Map<string, Set<string>>();

	for (const event of eventLog) {
		if (!event.userId) continue;

		const payload = event.payload as {id?: unknown; issue?: unknown};

		// `id` is the node an event targets; `issue` is how a comment names the
		// ticket it belongs to. Ids are unique across kinds, so a tag or
		// contributor event naming its own id can never match a ticket.
		for (const target of [payload.id, payload.issue]) {
			if (typeof target !== 'string') continue;

			const actors = byNode.get(target) ?? new Set<string>();
			actors.add(event.userId);
			byNode.set(target, actors);
		}
	}

	indexedLog = eventLog;
	actorsByNode = byNode;

	return byNode;
};

/**
 * Names of everyone who has written an event against this ticket. Resolved
 * through the registry by id, never off the log's file name, which is a
 * sanitized storage key.
 */
const getActorNames = (ticket: NavNode<'TICKET'>): string[] => {
	const {contributors} = getState();
	const actors = getActorsByNode().get(ticket.id);

	if (!actors) return [];

	return [...actors]
		.map(id => contributors[id]?.name)
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

		// Who did the work, as against `assignee`'s who it is for. A board worked
		// by several agents is unreadable without it.
		case 'actor': {
			const actorNames = getActorNames(ticket).map(normalizeText);
			return actorNames.some(name => name.includes(query));
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
