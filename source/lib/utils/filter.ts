import {AppEvent} from '../board/board-events.model.js';
import {Filter, Tag} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getState} from '../state/state.js';
import {getTicketGoal} from './goal.utils.js';
import {nodeRefMatches} from './node-ref.js';
import {normalizeText, textIncludes} from './text-match.js';

export type FilterField =
	| 'all'
	| 'title'
	| 'description'
	| 'tag'
	| 'goal'
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
 * Who has worked each node, from the log; rebuilt only when the log is
 * replaced, since filters run per ticket per keystroke.
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

		// `id` is an event's target; `issue` is a comment's ticket. Ids are unique
		// across kinds.
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

/** Names of everyone who wrote an event on this ticket, resolved by id. */
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

		// Part of the goal's name, as `tag` matches part of a tag's: `launch`
		// also finds "Launch mobile", where the GUI's pill names one goal.
		case 'goal': {
			const goal = getTicketGoal(ticket);
			return goal ? normalizeText(goal.name).includes(query) : false;
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

		default:
			return true;
	}
};
