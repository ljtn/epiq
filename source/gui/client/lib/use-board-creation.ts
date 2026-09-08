// The new-board modal: its title, and the send that creates the board.
//
// No optimistic board, unlike a new swimlane: the point of creating one is to
// go there, and a placeholder in the switcher is an entry whose route does not
// exist yet. The board arrives with the state that follows the result, and
// `board:create:result` is what navigates to it.

import {useState} from 'react';
import {BoardSocketActions} from './use-board-socket';

export const useBoardCreation = ({
	send,
}: {
	send: BoardSocketActions['send'];
}) => {
	const [createBoardTitle, setCreateBoardTitle] = useState<string | null>(null);

	const createBoard = () => {
		if (createBoardTitle === null) return;

		const title = createBoardTitle.trim() || 'New board';

		setCreateBoardTitle(null);
		send('board:create', {title});
	};

	return {createBoardTitle, setCreateBoardTitle, createBoard};
};
