import {GuiState, GuiSwimlane} from './gui-state.model';

// Its own MIME type rather than text/plain, which a ticket drag carries. The
// column body is a ticket drop target, so the two have to be distinguishable.
export const SWIMLANE_DRAG_TYPE = 'application/x-epiq-swimlane';

// `types` is the only thing readable during dragover — getData is blanked until
// drop, so the ticket handlers cannot ask what is being dragged any other way.
export const isSwimlaneDrag = (dataTransfer: DataTransfer | null): boolean =>
	Boolean(dataTransfer?.types.includes(SWIMLANE_DRAG_TYPE));

type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

const toMovePosition = (
	siblings: GuiSwimlane[],
	targetIndex: number,
): MovePosition => {
	if (siblings.length === 0) return {at: 'start'};
	if (targetIndex >= siblings.length) return {at: 'end'};

	return {at: 'before', sibling: siblings[Math.max(0, targetIndex)].id};
};

const reorder = (
	swimlanes: GuiSwimlane[],
	swimlaneId: string,
	targetIndex: number,
): GuiSwimlane[] => {
	const moved = swimlanes.find(swimlane => swimlane.id === swimlaneId);
	if (!moved) return swimlanes;

	const without = swimlanes.filter(swimlane => swimlane.id !== swimlaneId);
	const index = Math.max(0, Math.min(targetIndex, without.length));

	return [...without.slice(0, index), moved, ...without.slice(index)];
};

/**
 * `targetIndex` is an insertion point in the board's swimlanes *as rendered*,
 * so it counts the dragged column itself — which is why the position is
 * resolved against the list with that column already taken out.
 */
export const moveSwimlane =
	(
		// Read before the updater: React only runs an updater eagerly when nothing
		// is queued, so a position computed inside one cannot reach the send.
		state: GuiState | null,
		setState: React.Dispatch<React.SetStateAction<GuiState | null>>,
		send: (type: string, payload: unknown) => void,
	) =>
	(swimlaneId: string, boardId: string, targetIndex: number) => {
		if (!state) return;

		const board = state.boards.find(candidate => candidate.id === boardId);
		if (!board) return;

		const currentIndex = board.swimlanes.findIndex(
			swimlane => swimlane.id === swimlaneId,
		);
		if (currentIndex === -1) return;

		// Dropping either side of where it already sits is a no-op, and sending it
		// would still cost a write and a full state rebuild.
		if (targetIndex === currentIndex || targetIndex === currentIndex + 1)
			return;

		const withoutMoved = board.swimlanes.filter(
			swimlane => swimlane.id !== swimlaneId,
		);
		const indexWithoutMoved =
			targetIndex > currentIndex ? targetIndex - 1 : targetIndex;

		const position = toMovePosition(withoutMoved, indexWithoutMoved);

		setState(current =>
			current
				? {
						...current,
						boards: current.boards.map(candidate =>
							candidate.id === boardId
								? {
										...candidate,
										swimlanes: reorder(
											candidate.swimlanes,
											swimlaneId,
											indexWithoutMoved,
										),
								  }
								: candidate,
						),
				  }
				: current,
		);

		send('swimlane:move', {swimlaneId, boardId, position});
	};
