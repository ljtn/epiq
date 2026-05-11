import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {getEventTime} from '../../event/date-utils.js';
import {loadMergedEvents, splitEventsAtTime} from '../../event/event-load.js';
import {materializeAll} from '../../event/event-materialize.js';
import {Mode} from '../../model/action-map.model.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState, patchState, resetState} from '../../state/state.js';
import {resolveClosestEpiqRoot} from '../../storage/paths.js';
import {parsePeekDateInput} from '../validate-date.js';

export const peekCommand = async () => {
	const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
	if (isFail(boardNodeResult)) return boardNodeResult;

	const epiqRootDirResult = resolveClosestEpiqRoot(process.cwd());
	if (isFail(epiqRootDirResult)) throw new Error(epiqRootDirResult.message);

	const eventsResult = loadMergedEvents(epiqRootDirResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const allEvents = eventsResult.value;

	const {modifier} = getCmdState().commandMeta;
	let targetTime: number;

	if (modifier === 'now') {
		const resetResult = resetState();
		if (isFail(resetResult)) return resetResult;

		const materializeResult = materializeAll(allEvents);
		if (materializeResult.some(isFail)) {
			return failed(materializeResult.map(x => x.message).join(', '));
		}

		patchState({
			mode: Mode.DEFAULT,
			readOnly: false,
			timeMode: 'live',
			unappliedEvents: [],
		});

		return succeeded('Peeking now', true);
	}

	if (modifier === 'prev') {
		const previousEvent = getState().eventLog.at(-2);
		const previousTime = getEventTime(previousEvent);
		if (previousTime === null) return failed('No previous event to peek');
		targetTime = previousTime;
	} else if (modifier === 'next') {
		const nextEvent = getState().unappliedEvents.at(0);
		const nextTime = getEventTime(nextEvent);
		if (nextTime === null) return failed('No next event to peek');
		targetTime = nextTime;
	} else {
		const targetDate = parsePeekDateInput(modifier);
		if (!targetDate) {
			return failed('Invalid peek date');
		}

		targetTime = targetDate.getTime();
	}

	const boardId = boardNodeResult.value.id;
	const {appliedEvents, unappliedEvents} = splitEventsAtTime(
		allEvents,
		targetTime,
	);

	const resetResult = resetState();
	if (isFail(resetResult)) return resetResult;

	const materializeResult = materializeAll(appliedEvents);
	if (materializeResult.some(isFail)) {
		return failed(materializeResult.map(x => x.message).join(', '));
	}

	const boardNode = getState().nodes[boardId];
	if (!boardNode) {
		return failed('Board did not exist at peek date');
	}

	navigationUtils.navigate({
		contextNode: boardNode,
		selectedIndex: 0,
	});

	patchState({
		mode: Mode.DEFAULT,
		readOnly: true,
		timeMode: 'peek',
		unappliedEvents,
	});

	return succeeded('Peeking ', true);
};
