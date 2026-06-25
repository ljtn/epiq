import {getRepoRootDir, getStateBranchRoot} from '../../../git/git-storage.js';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {getEventTime} from '../../event/date-utils.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../../event/event-load.js';
import {materializeAll} from '../../event/event-materialize.js';
import {Mode} from '../../model/action-map.model.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState, patchState, resetState} from '../../state/state.js';
import {parsePeekArgs, parsePeekDateInput} from '../validate-date.js';
import {cancelActiveReplay, startReplay} from './peek-replay.js';

export const peekCommand = async () => {
	const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
	if (isFail(boardNodeResult)) return boardNodeResult;

	const repoRootResult = await getRepoRootDir(process.cwd());
	if (isFail(repoRootResult)) return failed('Unable to locate repo root');

	const stateBranchRoot = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRoot)) throw new Error(stateBranchRoot.message);

	const {modifier, inputString} = getCmdState().commandMeta;
	const {dateInput, isReplay} = parsePeekArgs(modifier, inputString);

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

	// A replay re-applies events forward in real time, which would fight an
	// in-flight sync reloading state underneath it. Refuse to start until sync
	// settles. (Regular static peeks are momentary, so they don't need this.)
	if (isReplay && getState().syncStatus.status === 'syncing') {
		return failed('Cannot replay while syncing, try again in a moment');
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
		// `dateInput` already has any trailing `play` keyword stripped off.
		const targetDate = parsePeekDateInput(dateInput);

		if (!targetDate) {
			return failed('Invalid peek date');
		}

		targetTime = targetDate.getTime();
	}

	const previousState = getState();
	const boardId = boardNodeResult.value.id;

	const eventsBeforeResult = loadMergedEventsBefore(
		stateBranchRoot.value,
		targetTime,
	);

	if (isFail(eventsBeforeResult)) {
		return failed(eventsBeforeResult.message);
	}

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

		return failed('Board did not exist at peek date');
	}

	const willReplay = isReplay && unappliedEvents.length > 0;

	navigationUtils.navigate({
		contextNode: boardNode,
		// A replay is a hands-off cinema view, so start with nothing selected to
		// suppress the selection highlight (navigation is disabled while it plays).
		// A static peek keeps the usual first-item selection.
		selectedIndex: willReplay ? -1 : 0,
	});

	// Replay forward only when there is actually history after the checkout
	// point. With nothing to play, fall through to a normal static peek so the
	// user still lands on the historical snapshot.
	if (willReplay) {
		startReplay({events: unappliedEvents, startTime: targetTime});

		return succeeded('Replaying board history', true);
	}

	patchState({
		mode: Mode.DEFAULT,
		readOnly: true,
		timeMode: 'peek',
		unappliedEvents,
		replay: null,
	});

	return succeeded('Peeking', true);
};
