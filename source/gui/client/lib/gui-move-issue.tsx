import {GuiIssue, GuiState} from './gui-state.model';

type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

const toMovePosition = (
	targetIssues: GuiIssue[],
	targetIndex: number | 'end',
): MovePosition => {
	if (targetIssues.length === 0) return {at: 'start'};
	if (targetIndex === 'end') return {at: 'end'};

	const index = Math.max(0, Math.min(targetIndex, targetIssues.length));

	if (index === 0) {
		return {
			at: 'before',
			sibling: targetIssues[0].id,
		};
	}

	if (index >= targetIssues.length) {
		return {at: 'end'};
	}

	return {
		at: 'before',
		sibling: targetIssues[index].id,
	};
};

const findMove = (
	state: GuiState,
	issueId: string,
	parentId: string,
	targetIndex: number | 'end',
) => {
	let movedIssue: GuiIssue | null = null;
	let sourceSwimlaneId: string | null = null;

	const targetSwimlane = state.boards
		.flatMap(board => board.swimlanes)
		.find(swimlane => swimlane.id === parentId);

	for (const board of state.boards) {
		for (const swimlane of board.swimlanes) {
			const issue = swimlane.issues.find(issue => issue.id === issueId);

			if (issue) {
				movedIssue = issue;
				sourceSwimlaneId = swimlane.id;
				break;
			}
		}

		if (movedIssue) break;
	}

	if (!movedIssue || !sourceSwimlaneId || !targetSwimlane) return null;

	const targetIssues =
		sourceSwimlaneId === targetSwimlane.id
			? targetSwimlane.issues.filter(issue => issue.id !== issueId)
			: targetSwimlane.issues;

	const position = toMovePosition(targetIssues, targetIndex);

	return {
		movedIssue,
		position,
		sourceParentId: sourceSwimlaneId,
		targetParentId: targetSwimlane.id,
	};
};

const applyMove = (
	state: GuiState,
	issueId: string,
	parentId: string,
	targetIndex: number | 'end',
	movedIssue: GuiIssue,
): GuiState => ({
	...state,
	boards: state.boards.map(board => ({
		...board,
		swimlanes: board.swimlanes.map(swimlane => {
			const issuesWithoutMoved = swimlane.issues.filter(
				issue => issue.id !== issueId,
			);

			if (swimlane.id !== parentId) {
				return {...swimlane, issues: issuesWithoutMoved};
			}

			const nextIssues = [...issuesWithoutMoved];

			const index =
				targetIndex === 'end'
					? nextIssues.length
					: Math.max(0, Math.min(targetIndex, nextIssues.length));

			nextIssues.splice(index, 0, movedIssue);

			return {...swimlane, issues: nextIssues};
		}),
	})),
});

export const moveIssue =
	(
		// Read here rather than inside the updater below. React runs an updater
		// synchronously only as an eager optimisation, and skips that whenever an
		// update is already queued — so anything the updater computes is not
		// available to the code that follows it, and the move would go unsent.
		state: GuiState | null,
		setState: React.Dispatch<React.SetStateAction<GuiState | null>>,
		// The caller's sender, so the move counts as an in-flight mutation like
		// every other one.
		send: (type: string, payload: unknown) => void,
	) =>
	(
		issueIds: readonly string[],
		parentId: string,
		targetIndex: number | 'end',
	) => {
		if (!state) return;

		// Applied one at a time against the running state, so the second ticket
		// lands after the first rather than both resolving against the board as
		// it looked before the drop.
		let running = state;

		for (const [offset, issueId] of issueIds.entries()) {
			const index = targetIndex === 'end' ? 'end' : targetIndex + offset;
			const move = findMove(running, issueId, parentId, index);
			if (!move) continue;

			running = applyMove(running, issueId, parentId, index, move.movedIssue);
			send('issues:move', {issueId, parentId, position: move.position});
		}

		const next = running;
		setState(current => (current ? next : current));
	};
