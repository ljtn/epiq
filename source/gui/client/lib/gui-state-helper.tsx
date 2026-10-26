import {
	GuiState,
	GuiIssue,
	GuiSwimlane,
	GuiTimeTravelStatus,
} from './gui-state.model';
import {Result} from './gui-result.model';

export const getResultValue = <T,>(payload: Result<T> | T): T | undefined => {
	if (!payload) return undefined;

	// A `value` key means a Result envelope: its value is the answer even when
	// absent, never the envelope itself.
	if (typeof payload === 'object' && payload !== null && 'value' in payload) {
		return (payload.value ?? undefined) as T | undefined;
	}

	if (
		typeof payload === 'object' &&
		payload !== null &&
		'content' in payload &&
		payload.content?.[0]?.text
	) {
		return JSON.parse(payload.content[0].text).value as T;
	}

	return payload as T;
};
// URL segments carry the ref; full ids still work and win. An ambiguous ref
// resolves to nothing rather than the wrong node.
const findByRefOrId = <T extends {id: string; ref: string}>(
	nodes: T[],
	refOrId: string,
): T | null => {
	const byId = nodes.find(node => node.id === refOrId);
	if (byId) return byId;

	const ref = refOrId.replace(/-/g, '').toUpperCase();
	const byRef = nodes.filter(node => node.ref === ref);

	return byRef.length === 1 ? byRef[0] ?? null : null;
};

export const findIssue = (
	state: GuiState,
	issueRefOrId: string,
): GuiIssue | null =>
	findByRefOrId(
		state.boards.flatMap(board =>
			board.swimlanes.flatMap(swimlane => swimlane.issues),
		),
		issueRefOrId,
	);

export const findBoard = (state: GuiState, boardRefOrId: string) =>
	findByRefOrId(state.boards, boardRefOrId);
// The swimlane counterpart. Rename passes a changed title, delete returns null
// and the lane is dropped — both applied optimistically
export const updateSwimlaneInGuiState = (
	state: GuiState,
	swimlaneId: string,
	updateSwimlane: (swimlane: GuiSwimlane) => GuiSwimlane | null,
): GuiState => ({
	...state,
	boards: state.boards.map(board => ({
		...board,
		swimlanes: board.swimlanes.flatMap(swimlane => {
			if (swimlane.id !== swimlaneId) return [swimlane];

			const next = updateSwimlane(swimlane);
			return next ? [next] : [];
		}),
	})),
});

export const updateIssueInGuiState = (
	state: GuiState,
	issueId: string,
	updateIssue: (issue: GuiIssue) => GuiIssue,
): GuiState => ({
	...state,
	boards: state.boards.map(board => ({
		...board,
		swimlanes: board.swimlanes.map(swimlane => ({
			...swimlane,
			issues: swimlane.issues.map(issue =>
				issue.id === issueId ? updateIssue(issue) : issue,
			),
		})),
	})),
});

/** Where a scrubbed board is cut, or null when it shows the present. */
export const scrubCut = (
	timeTravel: GuiTimeTravelStatus | undefined,
): number | null => (timeTravel?.mode === 'scrub' ? timeTravel.asOfTime : null);
