import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {loadMergedEventsBefore} from '../../event/event-load.js';
import {AppEvent} from '../../event/event.model.js';
import {materializeAll} from '../../event/event-materialize.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getState, patchState, resetState} from '../../state/state.js';

// Rewind the board to a historical point in time. Shared by `:peek` (which then
// holds the snapshot read-only) and `:replay` (which then animates forward from
// it). Materializes everything up to `targetTime`, leaving the later events for
// the caller to either ignore (peek) or play back (replay). On any failure the
// previous live state is restored so the caller is never left mid-checkout.
export const checkoutBoardAt = ({
	boardId,
	targetTime,
	stateBranchRoot,
	selectedIndex,
}: {
	boardId: string;
	targetTime: number;
	stateBranchRoot: string;
	// Where to land the selection after navigating to the historical board. Peek
	// keeps the usual first item; replay passes -1 to suppress the highlight while
	// the movie plays.
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
	const materializeFailures = materializeResult.filter(isFail);

	if (materializeFailures.length > 0) {
		resetState();
		patchState(previousState);

		return failed(materializeFailures.map(x => x.message).join(', '));
	}

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
