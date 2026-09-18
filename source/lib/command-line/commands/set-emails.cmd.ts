import {ulid} from 'ulid';
import {AppEvent} from '../../board/board-events.model.js';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {getStateBranch} from '../../../git/git-constants.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {emailsOf} from '../../model/email-link.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {Mode} from '../../model/action-map.model.js';
import {
	findEmailCandidates,
	offerableCandidates,
} from '../../repository/email-candidates.js';
import {getCmdState} from '../../state/cmd.state.js';
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
const numbered = (
	candidates: {email: string; names: string[]; commits: number}[],
): string =>
	candidates
		.map(
			(candidate, index) =>
				`${index + 1}. ${candidate.email} — ${candidate.commits} commit${
					candidate.commits === 1 ? '' : 's'
				} as ${candidate.names.join(', ') || 'unknown'}`,
		)
		.join('\n');

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

	const likely = candidates.filter(candidate => candidate.looksLikeYours);
	const offered = likely.length > 0 ? likely : candidates;

	if (offered.length === 0) {
		const persisted = setConfig({emailSetup: 'linked'});
		if (isFail(persisted)) return persisted;

		patchSettingsState({emailSetup: 'linked'});
		patchState({mode: Mode.DEFAULT});

		return succeeded('No unclaimed addresses in this history.', null);
	}

	// No argument: show the list. The pick is a second command, so the numbers
	// on screen are the ones being chosen from.
	if (!answer) {
		const mine = emailsOf(stateResult.value.emailLinks, userId);

		return succeeded(
			[
				mine.length > 0 ? `Already yours: ${mine.join(', ')}` : null,
				'Addresses in this history that nobody has claimed:',
				numbered(offered),
				'',
				'Claim them with :config emails 1,2 — or :config emails none to skip.',
				'A claim is permanent and reaches every clone.',
			]
				.filter(entry => entry !== null)
				.join('\n'),
			null,
		);
	}

	const picked = answer
		.split(/[,\s]+/)
		.filter(Boolean)
		.map(part => Number(part));

	if (picked.some(index => !Number.isInteger(index))) {
		return failed('Pick by number, e.g. :config emails 1,2');
	}

	const outOfRange = picked.filter(
		index => index < 1 || index > offered.length,
	);
	if (outOfRange.length > 0) {
		return failed(
			`No such address: ${outOfRange.join(', ')}. There are ${offered.length}.`,
		);
	}

	const chosen = picked.map(index => offered[index - 1]!);

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
		`Linked ${chosen
			.map(candidate => candidate.email)
			.join(', ')}. Every commit by ${
			chosen.length === 1 ? 'that address' : 'those addresses'
		} is now yours.`,
		null,
	);
};
