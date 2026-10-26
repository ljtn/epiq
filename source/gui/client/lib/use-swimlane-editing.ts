// The column editors: create and delete, each a modal whose state is held here
// and whose confirm applies to the board on screen before the server answers;
// and a lane's title and rules, set from its panel.

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
	const [deleteSwimlaneId, setDeleteSwimlaneId] = useState<string | null>(null);

	const createSwimlane = () => {
		if (createSwimlaneTitle === null || !selectedBoard) return;

		const title = createSwimlaneTitle.trim() || 'New swimlane';
		const boardId = selectedBoard.id;

		setCreateSwimlaneTitle(null);

		// Placeholder id: the real one arrives with the state that follows. Marked
		// readonly until then, which disables `+` and every write in its panel —
		// each would otherwise send this id, and the server has never heard of it.
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

	const renameSwimlane = (swimlaneId: string, given: string) => {
		const title = given.trim();

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

	const setSwimlaneRule = (swimlaneId: string, rule: 'done', on: boolean) => {
		setState(prev =>
			prev
				? updateSwimlaneInGuiState(prev, swimlaneId, swimlane => {
						const rules = (swimlane.rules ?? []).filter(kept => kept !== rule);
						const next = on ? [...rules, rule] : rules;
						const {rules: _rules, ...rest} = swimlane;
						return next.length > 0 ? {...rest, rules: next} : rest;
				  })
				: prev,
		);

		send('swimlane:rule:set', {swimlaneId, rule, on});
	};

	return {
		createSwimlaneTitle,
		setCreateSwimlaneTitle,
		renameSwimlane,
		setDeleteSwimlaneId,
		deletingSwimlane,
		createSwimlane,
		confirmDeleteSwimlane,
		setSwimlaneRule,
	};
};
