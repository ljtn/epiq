import {GuiEventTimeline} from '../gui-state.model';
import {BoardView, identityAxisFor} from './categories';

// What the scrubber's selection means for the board below it. Null when the
// selection narrows nothing, so the board is left alone.
export type BoardFilter = {
	axis: 'actor' | 'tag' | 'assignee';
	visibleIds: ReadonlySet<string>;
};

// Only a narrowed selection filters the board. A kind with everything still
// ticked is a colouring choice, not a question about which tickets matter.
export const buildBoardFilter = (
	view: BoardView,
	only: readonly string[] | null,
): BoardFilter | null => {
	const axis = identityAxisFor(view);
	if (axis === null || only === null) return null;

	return {axis, visibleIds: new Set(only)};
};

// Whether the window says which tickets its events belong to. Past the
// server's cap it answers with bucket counts alone, which name none — as
// against a quiet window, which names none because nothing happened.
export const windowNamesIssues = (timeline: GuiEventTimeline | null): boolean =>
	timeline === null ||
	timeline.events.length > 0 ||
	timeline.buckets.length === 0;

// Ticket ids the window holds an event for, which is what the window filter
// narrows the board to. Null where the board cannot be narrowed at all: before
// a timeline has arrived, and where the window names no tickets it counted.
export const windowIssueIds = (
	timeline: GuiEventTimeline | null,
): Set<string> | null => {
	if (timeline === null || !windowNamesIssues(timeline)) return null;

	const ids = new Set<string>();

	for (const entry of timeline.events) {
		if (entry.issue !== null) ids.add(entry.issue);
	}

	return ids;
};

// Read off the board's own state, which is already the state at the needle —
// so a filtered board answers "who/what, as of here", matching the moment the
// scrubber is parked on rather than the events inside the window.
export const issuePassesBoardFilter = (
	issue: {
		id: string;
		tags: {id: string}[];
		assignees: {id: string}[];
	},
	commentAuthorIds: readonly string[],
	filter: BoardFilter | null,
): boolean => {
	if (!filter) return true;

	const ids =
		filter.axis === 'tag'
			? issue.tags.map(tag => tag.id)
			: filter.axis === 'assignee'
			? issue.assignees.map(assignee => assignee.id)
			: commentAuthorIds;

	return ids.some(id => filter.visibleIds.has(id));
};
