import {GuiState, GuiIssue} from './gui-state.model';
import {Result} from './gui-result.model';

export const getResultValue = <T,>(payload: Result<T> | T): T | undefined => {
	if (!payload) return undefined;

	if (
		typeof payload === 'object' &&
		payload !== null &&
		'value' in payload &&
		payload.value
	) {
		return payload.value;
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
const matchesRefOrId = (
	node: {id: string; ref: string},
	refOrId: string,
): boolean =>
	node.id === refOrId || node.ref === refOrId.replace(/-/g, '').toUpperCase();

export const findIssue = (
	state: GuiState,
	issueRefOrId: string,
): GuiIssue | null => {
	for (const board of state.boards) {
		for (const swimlane of board.swimlanes) {
			const issue = swimlane.issues.find(issue =>
				matchesRefOrId(issue, issueRefOrId),
			);
			if (issue) return issue;
		}
	}

	return null;
};

export const findBoard = (state: GuiState, boardRefOrId: string) =>
	state.boards.find(board => matchesRefOrId(board, boardRefOrId)) ?? null;
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
