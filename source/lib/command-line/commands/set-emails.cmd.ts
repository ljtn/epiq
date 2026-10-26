import {ulid} from 'ulid';
import {AppEvent} from '../../board/board-events.model.js';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {getStateBranch} from '../../../git/git-constants.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {normalizeEmail} from '../../model/email-link.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {Mode} from '../../model/action-map.model.js';
import {
	findEmailCandidates,
	offerableCandidates,
} from '../../repository/email-candidates.js';
import {getCmdState} from '../../state/cmd.state.js';
import {setOfferedEmails} from '../../state/email-offers.state.js';
import {
	getSettingsState,
	patchSettingsState,
} from '../../state/settings.state.js';
import {getSafeState, patchState} from '../../state/state.js';
import {readEpiqConfig, setConfig} from '../../config/user-config.js';
import {currentBoardId, hasClaimedAnEmail} from '../../config/setup-utils.js';
import {resolveClosestEpiqProjectRoot} from '../../storage/paths.js';

/** Records this board's refusal locally; it must not replicate like a link. */
const declineEmailSetup = (): Result<null> => {
	const boardId = currentBoardId();

	// No board, nothing to decline; saying no always succeeds.
	if (!boardId) return succeeded('Nothing here to decline', null);

	// Read from disk, not the boot-time copy: another instance may have declined since.
	const stored = readEpiqConfig();
	const onDisk = isFail(stored) ? [] : stored.value.declinedEmailBoards ?? [];

	const declined = [...new Set([...onDisk, boardId])];

	const persisted = setConfig({declinedEmailBoards: declined});
	if (isFail(persisted)) return failed(persisted.message);

	patchSettingsState({
		declinedEmailBoards: [
			...new Set([...(getSettingsState().declinedEmailBoards ?? []), boardId]),
		],
	});

	return succeeded('Declined', null);
};

/**
 * Claims git addresses from a list drawn from this repository's history, so a
 * typo claims nothing. Nothing links itself.
 */
export const setEmailsCommand = async () => {
	const answer = getCmdState().commandMeta.inputString.trim();

	// Before any lookup: no must work whatever else is failing.
	if (answer === 'none') {
		const declined = declineEmailSetup();
		if (isFail(declined)) return declined;

		return succeeded(
			'Left unlinked. Your commits will show the name git signed them with. Run :config emails again to change that.',
			null,
		);
	}

	const {userId, userName, gitName} = getSettingsState();
	if (!userId) return failed('Set a username first with :config username');

	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed('Board is not loaded');

	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const branchResult = getStateBranch(repoRootResult.value);
	const scanned = await findEmailCandidates({
		repoRoot: repoRootResult.value,
		stateBranch: isFail(branchResult) ? undefined : branchResult.value,
		names: [userName, gitName],
		links: stateResult.value.emailLinks,
	});

	// A failed scan must not read as an empty history.
	if (isFail(scanned)) return scanned;

	const candidates = offerableCandidates(scanned.value);

	// All of them, in `EmailCandidates`' order, so the numbers match the screen.
	const offered = candidates;

	setOfferedEmails(offered.map(candidate => candidate.email));

	// Nothing to claim: record a decline so setup needn't scan git. Only for
	// someone with no claims, or a later unlink would leave the step silent.
	if (offered.length === 0) {
		if (!hasClaimedAnEmail()) {
			const declined = declineEmailSetup();
			if (isFail(declined)) return declined;
		}

		return succeeded('No unclaimed addresses in this history.', null);
	}

	// Bare, it opens the list screen: a successful command's message isn't shown.
	if (!answer) {
		patchState({mode: Mode.IDENTITY});
		return succeeded('Opened identity', null);
	}

	const parts = answer.split(/[,\s]+/).filter(Boolean);

	// The address itself, which is what the completion offers and what every
	// other command here takes: a value, not an index into a list.
	const chosen: typeof offered = [];
	const unknown: string[] = [];

	for (const part of parts) {
		const match = offered.find(
			candidate => candidate.email === normalizeEmail(part),
		);

		if (!match) {
			unknown.push(part);
			continue;
		}

		if (!chosen.includes(match)) chosen.push(match);
	}

	if (unknown.length > 0) {
		return failed(
			`Not on the list: ${unknown.join(', ')}. Pick one of ${offered
				.map(candidate => candidate.email)
				.join(', ')}.`,
		);
	}

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});
	if (isFail(stateBranchRootResult)) return stateBranchRootResult;

	const events = chosen.map(
		candidate =>
			({
				id: ulid(),
				action: 'link.contributor.email',
				payload: {contributor: userId, email: candidate.email},
				userId,
			} satisfies AppEvent<'link.contributor.email'>),
	);

	const written = materializeAndPersistAll(events, stateBranchRootResult.value);
	if (isFail(written)) return failed(written.message);

	// The link itself ends the setup step, from here or the GUI.
	return succeeded(
		`Claimed ${chosen
			.map(candidate => candidate.email)
			.join(', ')}. Every commit by ${
			chosen.length === 1 ? 'that address' : 'those addresses'
		} is now yours.`,
		null,
	);
};
