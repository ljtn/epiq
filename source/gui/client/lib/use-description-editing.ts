// The board's and the lanes' descriptions: which one the board's editor is
// open on, and the save.

import {Dispatch, SetStateAction, useState} from 'react';
import {
	descriptionLimitOf,
	normalizeDescription,
} from '../../../lib/utils/text.limits.js';
import {updateSwimlaneInGuiState} from './gui-state-helper';
import {GuiState} from './gui-state.model';
import {BoardSocketActions} from './use-board-socket';

export type DescribedNode = {kind: 'board' | 'swimlane'; id: string};

export const useDescriptionEditing = ({
	send,
	state,
	setState,
}: {
	send: BoardSocketActions['send'];
	state: GuiState | null;
	setState: Dispatch<SetStateAction<GuiState | null>>;
}) => {
	const [describing, setDescribing] = useState<DescribedNode | null>(null);

	// Resolved at render, so an edit landing from elsewhere reaches the editor.
	const target = (() => {
		if (!describing || !state) return null;

		const node =
			describing.kind === 'board'
				? state.boards.find(board => board.id === describing.id)
				: state.boards
						.flatMap(board => board.swimlanes)
						.find(swimlane => swimlane.id === describing.id);

		return node && !node.readonly
			? {...describing, title: node.title, description: node.description ?? ''}
			: null;
	})();

	// Applied to the board on screen before the server answers.
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

	const saveDescription = (text: string) => {
		if (!target) return;

		setDescribing(null);
		saveNodeDescription(target, text);
	};

	return {
		describing: target,
		describe: setDescribing,
		closeDescription: () => setDescribing(null),
		saveDescription,
		saveNodeDescription,
	};
};
