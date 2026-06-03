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

	const sourceSwimlane = state.swimlanes.find(swimlane =>
		swimlane.issues.some(issue => issue.id === issueId),
	);

	const targetSwimlane = state.swimlanes.find(
		swimlane => swimlane.id === parentId,
	);

	if (!sourceSwimlane || !targetSwimlane) return null;

	movedIssue =
		sourceSwimlane.issues.find(issue => issue.id === issueId) ?? null;

	if (!movedIssue) return null;

	const targetIssues =
		sourceSwimlane.id === targetSwimlane.id
			? targetSwimlane.issues.filter(issue => issue.id !== issueId)
			: targetSwimlane.issues;

	const position = toMovePosition(targetIssues, targetIndex);

	return {
		movedIssue,
		position,
		sourceParentId: sourceSwimlane.id,
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

			const nextSwimlanes = current.swimlanes.map(swimlane => {
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
			});

			return {
				...current,
				swimlanes: nextSwimlanes,
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
