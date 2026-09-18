import {ulid} from 'ulid';
import {AppEvent} from '../../board/board-events.model.js';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {getStateBranch} from '../../../git/git-constants.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {normalizeEmail} from '../../model/email-link.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
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
import {setConfig} from '../../config/user-config.js';
import {resolveClosestEpiqProjectRoot} from '../../storage/paths.js';

/**
 * Claiming the git addresses whose commits are yours.
 *
 * A list to pick from rather than a box to type an address into. You can only
 * claim what this repository's history already contains, so a typo claims
 * nothing and there is no way to reach for an address that was never yours.
 *
 * Asked once, as a setup step, because that is the moment somebody is already
 * thinking about who they are. Nothing links itself: every link here has a
 * person behind it who saw the address, the name on it and its commit count.
 */
export const setEmailsCommand = async () => {
	const answer = getCmdState().commandMeta.inputString.trim();

	// Before any lookup. Saying no must work whatever the board, the repository
	// or git is doing — it is the answer somebody gives precisely when the rest
	// of this is not working for them.
	// Declining is recorded so the setup step stops asking. Per machine, because
	// it is a fact about this person here, not about the board.
	if (answer === 'none') {
		const persisted = setConfig({emailSetup: 'declined'});
		if (isFail(persisted)) return persisted;

		patchSettingsState({emailSetup: 'declined'});
		patchState({mode: Mode.DEFAULT});

		return succeeded(
			'Left unlinked. Your commits will show the name git signed them with. Run :config emails again to change that.',
			null,
		);
	}

	const {userId, userName, gitEmail} = getSettingsState();
	if (!userId) return failed('Set a username first with :config username');

	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed('Board is not loaded');

	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const branchResult = getStateBranch(repoRootResult.value);
	const scanned = await findEmailCandidates({
		repoRoot: repoRootResult.value,
		stateBranch: isFail(branchResult) ? undefined : branchResult.value,
		names: [userName, gitEmail],
		links: stateResult.value.emailLinks,
	});

	// Said rather than swallowed: with nothing linking itself, this list is the
	// only way to claim an address, so a failed scan must not read as a history
	// with nothing left in it.
	if (isFail(scanned)) return scanned;

	const candidates = offerableCandidates(scanned.value);

	// Every offerable one, in the order `EmailCandidates` draws them. Filtering
	// here to the ones that look like the user's would renumber the list against
	// the screen they are reading it off, so `2` would claim whatever this
	// happened to think second.
	const offered = candidates;

	setOfferedEmails(offered.map(candidate => candidate.email));

	if (offered.length === 0) {
		const persisted = setConfig({emailSetup: 'linked'});
		if (isFail(persisted)) return persisted;

		patchSettingsState({emailSetup: 'linked'});
		patchState({mode: Mode.DEFAULT});

		return succeeded('No unclaimed addresses in this history.', null);
	}

	// Bare, it opens the screen that draws the list. A successful command's
	// message is discarded by the TUI, so the list cannot be the reply — and
	// during setup the step already draws it, where this is a no-op that leaves
	// the numbers on screen alone.
	if (!answer) {
		patchState({mode: Mode.IDENTITY});
		return succeeded('Opened identity', null);
	}

	const parts = answer.split(/[,\s]+/).filter(Boolean);

	// A number or the address itself. The completion offers addresses, so one
	// arrives here whenever somebody takes what was suggested, and refusing it
	// would make the suggestion a trap.
	const chosen: typeof offered = [];
	const unknown: string[] = [];

	for (const part of parts) {
		const byNumber = /^\d+$/.test(part) ? offered[Number(part) - 1] : undefined;
		const byEmail = offered.find(
			candidate => candidate.email === normalizeEmail(part),
		);
		const match = byNumber ?? byEmail;

		if (!match) {
			unknown.push(part);
			continue;
		}

		if (!chosen.includes(match)) chosen.push(match);
	}

	if (unknown.length > 0) {
		return failed(
			`Not on the list: ${unknown.join(', ')}. Pick a number from 1 to ${
				offered.length
			}, or the address itself.`,
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

	const persisted = setConfig({emailSetup: 'linked'});
	if (isFail(persisted)) return persisted;

	patchSettingsState({emailSetup: 'linked'});
	patchState({mode: Mode.DEFAULT});

	return succeeded(
		`Claimed ${chosen
			.map(candidate => candidate.email)
			.join(', ')}. Every commit by ${
			chosen.length === 1 ? 'that address' : 'those addresses'
		} is now yours.`,
		null,
	);
};
