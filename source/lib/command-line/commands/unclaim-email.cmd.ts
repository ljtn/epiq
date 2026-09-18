import {ulid} from 'ulid';
import {AppEvent} from '../../board/board-events.model.js';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {emailsOf, normalizeEmail} from '../../model/email-link.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getSettingsState} from '../../state/settings.state.js';
import {getSafeState, patchState} from '../../state/state.js';
import {resolveClosestEpiqProjectRoot} from '../../storage/paths.js';

/**
 * Gives an address back.
 *
 * Only your own, and only ones you hold: the event is refused for anyone else
 * anyway, so offering it here would be offering something that cannot work.
 * The address stops resolving to you; the record of the claim stays in the log.
 */
export const unclaimEmailCommand = () => {
	const answer = getCmdState().commandMeta.inputString.trim();

	const {userId} = getSettingsState();
	if (!userId) return failed('Set a username first with :config username');

	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed('Board is not loaded');

	const held = emailsOf(stateResult.value.emailLinks, userId);

	if (held.length === 0) {
		return failed('You have not claimed any addresses.');
	}

	if (!answer) {
		return failed(`Which one? ${held.join(', ')}.`);
	}

	const email = held.find(one => one === normalizeEmail(answer));

	if (!email) {
		return failed(`You have not claimed ${answer}. Yours: ${held.join(', ')}.`);
	}

	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return repoRootResult;

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});
	if (isFail(stateBranchRootResult)) return stateBranchRootResult;

	const written = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'unlink.contributor.email',
				payload: {contributor: userId, email},
				userId,
			} satisfies AppEvent<'unlink.contributor.email'>,
		],
		stateBranchRootResult.value,
	);

	if (isFail(written)) return failed(written.message);

	patchState({mode: Mode.DEFAULT});

	return succeeded(`Unclaimed ${email}`, null);
};
