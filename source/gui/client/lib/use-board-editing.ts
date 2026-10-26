// The board editors: create and rename modals. Create waits for the server,
// since it navigates to the new board; rename applies at once.

import {Dispatch, SetStateAction, useState} from 'react';
import {GuiState} from './gui-state.model';
import {BoardSocketActions} from './use-board-socket';

export const useBoardEditing = ({
	send,
	setState,
	selectedBoard,
}: {
	send: BoardSocketActions['send'];
	setState: Dispatch<SetStateAction<GuiState | null>>;
	selectedBoard: GuiState['boards'][number] | null;
}) => {
	const [createBoardTitle, setCreateBoardTitle] = useState<string | null>(null);
	const [renameBoard, setRenameBoard] = useState<{
		boardId: string;
		title: string;
	} | null>(null);

	const createBoard = () => {
		if (createBoardTitle === null) return;

		const title = createBoardTitle.trim() || 'New board';

		setCreateBoardTitle(null);
		send('board:create', {title});
	};

	// Only the board on screen: the palette has no other board in hand, and it
	// is the one whose title the reader is looking at.
	const openRenameBoard = () => {
		if (!selectedBoard || selectedBoard.readonly) return;

		setRenameBoard({boardId: selectedBoard.id, title: selectedBoard.title});
	};

	const submitRenameBoard = () => {
		if (!renameBoard) return;

		const {boardId} = renameBoard;
		const title = renameBoard.title.trim();

		setRenameBoard(null);

		// An empty title is refused by the server, and blanking a board is never
		// what the reader meant by it, so treat it as a cancel.
		if (!title) return;

		setState(prev =>
			prev
				? {
						...prev,
						boards: prev.boards.map(board =>
							board.id === boardId ? {...board, title} : board,
						),
				  }
				: prev,
		);

		send('board:edit:title', {boardId, title});
	};

	return {
		createBoardTitle,
		setCreateBoardTitle,
		createBoard,
		renameBoard,
		setRenameBoard,
		openRenameBoard,
		submitRenameBoard,
	};
};
