// The board editors: create and rename, each a modal whose state is held here.
//
// No optimistic board on create, unlike a new swimlane: the point of creating
// one is to go there, and a placeholder in the switcher is an entry whose route
// does not exist yet. The board arrives with the state that follows the result,
// and `board:create:result` is what navigates to it. A rename does apply to the
// board on screen before the server answers: the switcher and the title are
// already showing it, and nothing routes on it.

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
