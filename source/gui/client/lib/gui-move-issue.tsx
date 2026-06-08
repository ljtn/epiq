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

export const moveIssue =
	(
		setState: React.Dispatch<React.SetStateAction<GuiState | null>>,
		socketRef: React.RefObject<WebSocket | null>,
	) =>
	(issueId: string, parentId: string, targetIndex: number | 'end') => {
		let position: MovePosition | null = null;

		setState(current => {
			if (!current) return current;

			const move = findMove(current, issueId, parentId, targetIndex);
			if (!move) return current;

			position = move.position;

			return {
				...current,
				boards: current.boards.map(board => ({
					...board,
					swimlanes: board.swimlanes.map(swimlane => {
						const issuesWithoutMoved = swimlane.issues.filter(
							issue => issue.id !== issueId,
						);

						if (swimlane.id !== parentId) {
							return {
								...swimlane,
								issues: issuesWithoutMoved,
							};
						}

						const nextIssues = [...issuesWithoutMoved];

						const index =
							targetIndex === 'end'
								? nextIssues.length
								: Math.max(0, Math.min(targetIndex, nextIssues.length));

						nextIssues.splice(index, 0, move.movedIssue);

						return {
							...swimlane,
							issues: nextIssues,
						};
					}),
				})),
			};
		});

		if (!position) return;

		socketRef.current?.send(
			JSON.stringify({
				type: 'issues:move',
				payload: {
					issueId,
					parentId,
					position,
				},
			}),
		);
	};
