import {getRepoRootDir, getStateBranchRoot} from '../../../git/git-storage.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState, patchState, resetState} from '../../state/state.js';
import {
	DEFAULT_REPLAY_DURATION_MS,
	parsePeekDateInput,
	parseReplayArgs,
	parseReplayDuration,
} from '../validate-date.js';
import {checkoutBoardAt} from './checkout-board.js';
import {cancelActiveReplay, startReplay} from './replay-engine.js';

export const replayCommand = async () => {
	const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
	if (isFail(boardNodeResult)) return boardNodeResult;

	const repoRootResult = await getRepoRootDir(process.cwd());
	if (isFail(repoRootResult)) return failed('Unable to locate repo root');

	const stateBranchRoot = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRoot)) return stateBranchRoot;

	const {modifier, inputString} = getCmdState().commandMeta;
	const {dateInput, durationInput} = parseReplayArgs(modifier, inputString);

	// Any new replay supersedes one already in progress, so tear down the running
	// movie before starting another.
	cancelActiveReplay();

	// A replay re-applies events forward in real time, which would fight an
	// in-flight sync reloading state underneath it. Refuse to start until sync
	// settles.
	if (getState().syncStatus.status === 'syncing') {
		return failed('Cannot replay while syncing, try again in a moment');
	}

	const targetDate = parsePeekDateInput(dateInput);
	if (!targetDate) return failed('Invalid replay date');

	const durationMs = durationInput
		? parseReplayDuration(durationInput)
		: DEFAULT_REPLAY_DURATION_MS;

	if (durationMs === null) {
		return failed('Invalid replay duration (try e.g. 30s or 2m)');
	}

	const targetTime = targetDate.getTime();

	// Snapshot the live state so we can put the board back exactly as it was if the
	// checkout turns out to have nothing to play forward.
	const previousState = getState();

	const checkoutResult = checkoutBoardAt({
		boardId: boardNodeResult.value.id,
		targetTime,
		stateBranchRoot: stateBranchRoot.value,
		// A replay is a hands-off cinema view, so start with nothing selected to
		// suppress the selection highlight (navigation is disabled while it plays).
		selectedIndex: -1,
	});

	if (isFail(checkoutResult)) return checkoutResult;

	const {unappliedEvents} = checkoutResult.value;

	// With no history after the checkout point there is nothing to play forward.
	if (unappliedEvents.length === 0) {
		resetState();
		patchState(previousState);

		return succeeded('Nothing to replay from that point', true);
	}

	startReplay({events: unappliedEvents, startTime: targetTime, durationMs});

	return succeeded('Replaying board history', true);
};
