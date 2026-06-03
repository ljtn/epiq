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

export const moveIssue =
	(
		setState: React.Dispatch<React.SetStateAction<GuiState | null>>,
		socketRef: React.RefObject<WebSocket | null>,
	) =>
	(issueId: string, parentId: string, targetIndex: number | 'end') => {
		let position: MovePosition | null = null;

		setState(current => {
			if (!current) return current;

			let movedIssue: GuiIssue | null = null;

			const swimlanesWithoutIssue = current.swimlanes.map(swimlane => {
				const issues = swimlane.issues.filter(issue => {
					if (issue.id !== issueId) return true;
					movedIssue = issue;
					return false;
				});

				return {...swimlane, issues};
			});

			if (!movedIssue) return current;

			const nextSwimlanes = swimlanesWithoutIssue.map(swimlane => {
				if (swimlane.id !== parentId) return swimlane;

				const nextIssues = [...swimlane.issues];

				position = toMovePosition(nextIssues, targetIndex);

				const index =
					targetIndex === 'end'
						? nextIssues.length
						: Math.max(0, Math.min(targetIndex, nextIssues.length));

				nextIssues.splice(index, 0, movedIssue!);

				return {...swimlane, issues: nextIssues};
			});

			if (!position) return current;

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
