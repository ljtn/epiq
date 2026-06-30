import {getRepoRootDir, getStateBranchRoot} from '../../../git/git-storage.js';
import {getEventTime} from '../../event/date-utils.js';
import {loadMergedEvents} from '../../event/event-load.js';
import {materializeAll} from '../../event/event-materialize.js';
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
		const materializeFailures = materializeResult.filter(isFail);

		if (materializeFailures.length > 0) {
			return failed(materializeFailures.map(x => x.message).join(', '));
		}

		patchState({
			mode: Mode.DEFAULT,
			readOnly: false,
			timeMode: 'live',
			unappliedEvents: [],
			replay: null,
		});

		return succeeded('Peeking now', true);
	}

	let targetTime: number;

	if (modifier === 'prev') {
		const previousEvent = getState().eventLog.at(-1);
		const previousTime = getEventTime(previousEvent);

		if (previousTime === null) return failed('No previous event to peek');

		targetTime = previousTime;
	} else if (modifier === 'next') {
		const nextEvent = getState().unappliedEvents.at(0);
		const nextTime = getEventTime(nextEvent);

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
