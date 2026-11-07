import {useEffect, useState} from 'react';
import {GuiBoard, GuiGoal} from './gui-state.model';

type OpenGoal = {id: string; boardId: string};

/**
 * The goal whose panel is open, held to the board that opened it: on any other
 * board there is none.
 */
export const useGoalPanel = ({
	goals,
	board,
	scrubbing,
	issueId,
}: {
	goals: GuiGoal[] | undefined;
	board: GuiBoard | null | undefined;
	scrubbing: boolean;
	issueId: string | undefined;
}) => {
	const [open, setOpen] = useState<OpenGoal | null>(null);

	const onBoard =
		open?.boardId === board?.id &&
		Boolean(board?.goals.some(goal => goal.id === open?.id));
	const goal = onBoard
		? goals?.find(candidate => candidate.id === open?.id) ?? null
		: null;

	// Gone from its board, it stays gone: a ticket reopened later brings the
	// pill back, not the panel. A scrub only looks.
	const gone =
		open !== null && !scrubbing && open.boardId === board?.id && !onBoard;
	useEffect(() => {
		if (gone) setOpen(null);
	}, [gone]);

	// Back, or a commit's ref: a ticket arriving by URL clears nothing else.
	useEffect(() => {
		if (issueId) setOpen(null);
	}, [issueId]);

	return {
		goal,
		open: (id: string, boardId: string | null) =>
			setOpen(boardId ? {id, boardId} : null),
		close: () => setOpen(null),
	};
};
