// The column editors: create, rename and delete, each a modal whose state is
// held here and whose confirm applies to the board on screen before the
// server answers.

import {Dispatch, SetStateAction, useState} from 'react';
import {updateSwimlaneInGuiState} from './gui-state-helper';
import {GuiState, GuiSwimlane} from './gui-state.model';
import {BoardSocketActions} from './use-board-socket';

export const useSwimlaneEditing = ({
	send,
	setState,
	selectedBoard,
	visibleSwimlanes,
}: {
	send: BoardSocketActions['send'];
	setState: Dispatch<SetStateAction<GuiState | null>>;
	selectedBoard: GuiState['boards'][number] | null;
	visibleSwimlanes: GuiSwimlane[];
}) => {
	// Only a title: the board it lands on is whichever one is on screen.
	const [createSwimlaneTitle, setCreateSwimlaneTitle] = useState<string | null>(
		null,
	);
	const [renameSwimlane, setRenameSwimlane] = useState<{
		swimlaneId: string;
		title: string;
	} | null>(null);
	const [deleteSwimlaneId, setDeleteSwimlaneId] = useState<string | null>(null);

	const createSwimlane = () => {
		if (createSwimlaneTitle === null || !selectedBoard) return;

		const title = createSwimlaneTitle.trim() || 'New swimlane';
		const boardId = selectedBoard.id;

		setCreateSwimlaneTitle(null);

		// Placeholder id: the real one arrives with the state that follows. Marked
		// readonly until then, which hides the kebab and disables `+` — both would
		// otherwise send this id, and the server has never heard of it.
		setState(prev =>
			prev
				? {
						...prev,
						boards: prev.boards.map(board =>
							board.id === boardId
								? {
										...board,
										swimlanes: [
											...board.swimlanes,
											{
												id: `pending-swimlane-${title}`,
												title,
												readonly: true,
												issues: [],
											},
										],
								  }
								: board,
						),
				  }
				: prev,
		);

		send('swimlane:create', {title, boardId});
	};

	const openRenameSwimlane = (swimlaneId: string) => {
		const swimlane = visibleSwimlanes.find(x => x.id === swimlaneId);
		if (!swimlane) return;

		setRenameSwimlane({swimlaneId, title: swimlane.title});
	};

	const submitRenameSwimlane = () => {
		if (!renameSwimlane) return;

		const {swimlaneId} = renameSwimlane;
		const title = renameSwimlane.title.trim();

		setRenameSwimlane(null);

		// An empty title is refused by the server, and blanking a column is never
		// what the reader meant by it, so treat it as a cancel.
		if (!title) return;

		setState(prev =>
			prev
				? updateSwimlaneInGuiState(prev, swimlaneId, swimlane => ({
						...swimlane,
						title,
				  }))
				: prev,
		);

		send('swimlane:edit:title', {swimlaneId, title});
	};

	// From the board rather than the filtered lanes, and resolved at render
	// rather than captured when the menu was clicked: the confirm counts what the
	// delete destroys, which a board filter must not be able to talk down.
	const deletingSwimlane =
		selectedBoard?.swimlanes.find(x => x.id === deleteSwimlaneId) ?? null;

	const confirmDeleteSwimlane = () => {
		if (!deleteSwimlaneId) return;

		setState(prev =>
			prev
				? updateSwimlaneInGuiState(prev, deleteSwimlaneId, () => null)
				: prev,
		);

		send('swimlane:delete', {swimlaneId: deleteSwimlaneId});
		setDeleteSwimlaneId(null);
	};

	return {
		createSwimlaneTitle,
		setCreateSwimlaneTitle,
		renameSwimlane,
		setRenameSwimlane,
		setDeleteSwimlaneId,
		deletingSwimlane,
		createSwimlane,
		openRenameSwimlane,
		submitRenameSwimlane,
		confirmDeleteSwimlane,
	};
};
