// Which tickets are features, and how far along each is. A ticket is a feature
// by having tickets that belong to it, so this is read off the board's state,
// never stored: the members say so.

import {GuiIssue, GuiState} from './gui-state.model';

export type FeatureSummary = {
	id: string;
	color: string;
	members: GuiIssue[];
	// Closed, or standing in a lane called Done.
	done: number;
};

export type FeatureIndex = ReadonlyMap<string, FeatureSummary>;

export const EMPTY_FEATURES: FeatureIndex = new Map();

/** Every ticket on every board, closed ones included. */
export const allIssues = (state: GuiState): GuiIssue[] =>
	state.boards.flatMap(board => board.swimlanes.flatMap(lane => lane.issues));

export const buildFeatureIndex = (state: GuiState): FeatureIndex => {
	// By name, not by place: lanes are in whatever order a team put them.
	const doneLaneIds = new Set(
		state.boards.flatMap(board =>
			board.swimlanes
				.filter(lane => lane.title.trim().toLowerCase() === 'done')
				.map(lane => lane.id),
		),
	);
	const laneOf = new Map(
		state.boards.flatMap(board =>
			board.swimlanes.flatMap(lane =>
				lane.issues.map(issue => [issue.id, lane.id] as const),
			),
		),
	);

	const index = new Map<string, FeatureSummary>();

	for (const issue of allIssues(state)) {
		const feature = issue.feature;
		if (!feature) continue;

		const summary = index.get(feature.id) ?? {
			id: feature.id,
			color: feature.color,
			members: [],
			done: 0,
		};

		summary.members.push(issue);
		if (issue.isClosed || doneLaneIds.has(laneOf.get(issue.id) ?? '')) {
			summary.done++;
		}

		index.set(feature.id, summary);
	}

	return index;
};
