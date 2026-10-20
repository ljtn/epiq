// A board's or a lane's description, saved from its panel: applied to the
// board on screen before the server answers.

import {Dispatch, SetStateAction} from 'react';
import {normalizeDescription} from '../../../lib/utils/text.limits.js';
import {updateSwimlaneInGuiState} from './gui-state-helper';
import {GuiState} from './gui-state.model';
import {BoardSocketActions} from './use-board-socket';

export type DescribedNode = {kind: 'board' | 'swimlane'; id: string};

export const useDescriptionEditing = ({
	send,
	setState,
}: {
	send: BoardSocketActions['send'];
	setState: Dispatch<SetStateAction<GuiState | null>>;
}) => {
	const saveNodeDescription = ({kind, id}: DescribedNode, text: string) => {
		const description = normalizeDescription(text);
		const next = description || undefined;

		setState(prev => {
			if (!prev) return prev;

			return kind === 'board'
				? {
						...prev,
						boards: prev.boards.map(board =>
							board.id === id ? {...board, description: next} : board,
						),
				  }
				: updateSwimlaneInGuiState(prev, id, swimlane => ({
						...swimlane,
						description: next,
				  }));
		});

		send(
			kind === 'board' ? 'board:edit:description' : 'swimlane:edit:description',
			kind === 'board'
				? {boardId: id, description}
				: {swimlaneId: id, description},
		);
	};

	return {saveNodeDescription};
};
