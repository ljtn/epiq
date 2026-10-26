import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {loadMergedEventsBefore} from '../../board/board-log.js';
import {AppEvent} from '../../board/board-events.model.js';
import {
	logSkippedEvents,
	materializeAll,
	partitionMaterializeResults,
} from '../../board/board-log.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getState, patchState, resetState} from '../../state/state.js';

// Rewinds the board to `targetTime` for `:peek` and `:replay`, leaving later
// events to the caller. Restores live state on any failure.
export const checkoutBoardAt = ({
	boardId,
	targetTime,
	stateBranchRoot,
	selectedIndex,
}: {
	boardId: string;
	targetTime: number;
	stateBranchRoot: string;
	// Selection after navigating; replay passes -1 to hide it during the movie.
	selectedIndex: number;
}): Result<{unappliedEvents: AppEvent[]}> => {
	const previousState = getState();

	const eventsBeforeResult = loadMergedEventsBefore(
		stateBranchRoot,
		targetTime,
	);
	if (isFail(eventsBeforeResult)) return failed(eventsBeforeResult.message);

	const {appliedEvents, unappliedEvents} = eventsBeforeResult.value;

	const resetResult = resetState();
	if (isFail(resetResult)) return resetResult;

	const materializeResult = materializeAll(appliedEvents);
	const {fatal, skipped} = partitionMaterializeResults(materializeResult);

	if (fatal.length > 0) {
		resetState();
		patchState(previousState);

		return failed(fatal.map(x => x.message).join(', '));
	}
	logSkippedEvents(skipped);

	const boardNode = getState().nodes[boardId];

	if (!boardNode) {
		resetState();
		patchState(previousState);

		return failed('Board did not exist at that date');
	}

	navigationUtils.navigate({
		contextNode: boardNode,
		selectedIndex,
	});

	return succeeded('', {unappliedEvents});
};
