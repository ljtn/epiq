import {getRepoRootDir, getStateBranchRoot} from '../../../git/git-storage.js';
import {clampUlidTime, getEventTime} from '../../event/date-utils.js';
import {
	loadEffectiveEventTimes,
	loadMergedEvents,
} from '../../event/event-load.js';
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

	if (modifier === 'prev' || modifier === 'next') {
		// Effective times over the same full set splitEventsAtTime judges by, so
		// a step onto a poisoned far-future id cuts where the checkout will.
		const stepTimes = loadEffectiveEventTimes(stateBranchRoot.value);
		if (isFail(stepTimes)) return stepTimes;

		const stepEvent =
			modifier === 'prev'
				? getState().eventLog.at(-1)
				: getState().unappliedEvents.at(0);

		// An event minted this session carries its creation ULID in memory, while
		// the log carries the edge-chained id `persist` assigned it, so the lookup
		// misses until a reload puts the persisted ids back into state. That id is
		// honest by construction — the mint guard clamps it — so it stands in.
		const ownTime = stepEvent === undefined ? null : getEventTime(stepEvent);
		const stepTime =
			(stepEvent === undefined
				? null
				: stepTimes.value.get(stepEvent.id) ?? null) ??
			(ownTime === null ? null : clampUlidTime(ownTime));

		if (stepTime === null) {
			return failed(
				modifier === 'prev'
					? 'No previous event to peek'
					: 'No next event to peek',
			);
		}

		targetTime = modifier === 'prev' ? stepTime : stepTime + 1;
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
