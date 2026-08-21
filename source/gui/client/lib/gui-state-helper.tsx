import {GuiState, GuiIssue, GuiSwimlane} from './gui-state.model';
import {Result} from './gui-result.model';

export const getResultValue = <T,>(payload: Result<T> | T): T | undefined => {
	if (!payload) return undefined;

	// A `value` key means this is a Result envelope, so its value is the answer
	// even when there isn't one. Falling through on a failed Result would hand
	// back `{status, message, value}` as if it were a T — which is how a repo
	// with no epiq project turned into a white page: the caller got the
	// envelope, read `.boards` off it, and threw mid-render.
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
// URL segments carry the shorthand ref, but full ids (old links) still work.
// A full id is unique by construction and wins outright. Refs are random
// tails, so two nodes can theoretically share one; resolving an ambiguous ref
// to "whichever came first" would silently open the wrong node, so it
// resolves to nothing instead.
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
// and the lane is dropped — both applied optimistically, the way every other
// mutation on the board already is.
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
