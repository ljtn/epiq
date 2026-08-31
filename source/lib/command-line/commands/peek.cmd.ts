import {getRepoRootDir, getStateBranchRoot} from '../../../git/git-storage.js';
import {clampUlidTimes, getEventTime} from '../../event/date-utils.js';
import {loadMergedEvents} from '../../event/event-load.js';
import {
	logSkippedEvents,
	materializeAll,
	partitionMaterializeResults,
} from '../../event/event-materialize.js';
import {Mode} from '../../model/action-map.model.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState, patchState, resetState} from '../../state/state.js';
import {parsePeekDateInput} from '../validate-date.js';
import {checkoutBoardAt} from './checkout-board.js';
import {cancelActiveReplay} from './replay-engine.js';

export const peekCommand = async () => {
	const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
	if (isFail(boardNodeResult)) return boardNodeResult;

	const repoRootResult = await getRepoRootDir(process.cwd());
	if (isFail(repoRootResult)) return failed('Unable to locate repo root');

	const stateBranchRoot = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRoot)) return stateBranchRoot;

	const {modifier, inputString} = getCmdState().commandMeta;

	// Any new peek command supersedes a replay in progress, so always tear down
	// the running movie before doing anything else.
	cancelActiveReplay();

	if (modifier === 'now') {
		const eventsResult = loadMergedEvents(stateBranchRoot.value);
		if (isFail(eventsResult)) return failed(eventsResult.message);

		const resetResult = resetState();
		if (isFail(resetResult)) return resetResult;

		const materializeResult = materializeAll(eventsResult.value);
		const {fatal, skipped} = partitionMaterializeResults(materializeResult);

		if (fatal.length > 0) {
			return failed(fatal.map(x => x.message).join(', '));
		}
		logSkippedEvents(skipped);

		patchState({
			mode: Mode.DEFAULT,
			readOnly: false,
			// Cleared alongside the flag it explains, or a later time-travel
			// refusal quotes a stale unreadable-log reason.
			readOnlyReason: undefined,
			timeMode: 'live',
			unappliedEvents: [],
			replay: null,
		});

		return succeeded('Peeking now', true);
	}

	let targetTime: number;

	// Clamped over the same full set splitEventsAtTime sees, so a step onto a
	// poisoned far-future id cuts where the checkout will.
	const {eventLog, unappliedEvents} = getState();
	const stepTimes = clampUlidTimes(
		[...eventLog, ...unappliedEvents].map(event => getEventTime(event)),
	);

	if (modifier === 'prev') {
		const previousTime =
			eventLog.length > 0 ? stepTimes[eventLog.length - 1] ?? null : null;

		if (previousTime === null) return failed('No previous event to peek');

		targetTime = previousTime;
	} else if (modifier === 'next') {
		const nextTime =
			unappliedEvents.length > 0 ? stepTimes[eventLog.length] ?? null : null;

		if (nextTime === null) return failed('No next event to peek');

		targetTime = nextTime + 1;
	} else {
		// Offsets (e.g. `2y`) arrive as `modifier`; absolute dates (YYYY-MM-DD)
		// are not in the modifier allow-list, so they arrive as `inputString`.
		const targetDate = parsePeekDateInput(modifier || inputString.trim());

		if (!targetDate) {
			return failed('Invalid peek date');
		}

		targetTime = targetDate.getTime();
	}

	const checkoutResult = checkoutBoardAt({
		boardId: boardNodeResult.value.id,
		targetTime,
		stateBranchRoot: stateBranchRoot.value,
		selectedIndex: 0,
	});

	if (isFail(checkoutResult)) return checkoutResult;

	patchState({
		mode: Mode.DEFAULT,
		readOnly: true,
		timeMode: 'peek',
		unappliedEvents: checkoutResult.value.unappliedEvents,
		replay: null,
	});

	return succeeded('Peeking', true);
};
