// A board's, lane's or goal's description, saved from its panel: applied to
// the board on screen before the server answers.

import {Dispatch, SetStateAction} from 'react';
import {normalizeDescription} from '../../../lib/utils/text.limits.js';
import {updateSwimlaneInGuiState} from './gui-state-helper';
import {GuiState} from './gui-state.model';
import {BoardSocketActions} from './use-board-socket';

export type DescribedNode = {kind: 'board' | 'swimlane' | 'goal'; id: string};

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

		if (kind === 'goal') {
			// The panel reads the project's goals; a board's copy shows no description.
			setState(prev =>
				prev
					? {
							...prev,
							goals: prev.goals.map(goal =>
								goal.id === id ? {...goal, description: next} : goal,
							),
					  }
					: prev,
			);
			send('goal:edit:description', {goalId: id, description});
			return;
		}

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
