import {ulid} from 'ulid';
import {AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {
	canRemoveEmailLink,
	claimantsOf,
	emailLinkKey,
	emailsOf,
	isValidEmail,
	normalizeEmail,
} from '../../lib/model/email-link.js';
import {identityOf} from '../../lib/model/identity.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {getStateBranch} from '../../git/git-constants.js';
import {readGitName} from '../../lib/config/git-identity.js';
import {
	findEmailCandidates,
	offerableCandidates,
} from '../../lib/repository/email-candidates.js';
import {getSettingsState} from '../../lib/state/settings.state.js';
import {
	ToolInput,
	bootLocal,
	bootedWithActorAndState,
	getActor,
	getStateResult,
} from './boot.js';

type LinkInput = ToolInput & {email: string; contributorId?: string};

/** Binds a git address to a contributor, by default the caller; a colleague may be named. */
export const linkContributorEmail = async (
	input: LinkInput,
): Promise<
	Result<{contributor: string; email: string; contested: string[]}>
> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	if (!isValidEmail(input.email)) {
		return failed(`Not an email address: ${input.email}`);
	}

	const email = normalizeEmail(input.email);
	const contributor = input.contributorId ?? ready.value.actor.userId;

	if (!ready.value.state.contributors[contributor]) {
		return failed(`Unknown contributor: ${contributor}`);
	}

	const already = claimantsOf(ready.value.state.emailLinks, email);
	if (already.includes(contributor)) {
		return succeeded(`${email} is already yours`, {
			contributor,
			email,
			contested: already.filter(id => id !== contributor),
		});
	}

	const results = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'link.contributor.email',
				payload: {contributor, email},
				userId: ready.value.actor.userId,
			} satisfies AppEvent<'link.contributor.email'>,
		],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	// Reported rather than refused: a second claim is legal, and the caller is
	// the one who can tell a shared team address from a mistake.
	return succeeded(
		already.length > 0
			? `Claimed ${email}, but somebody else claims it too, so it now resolves to neither of you`
			: `Claimed ${email}`,
		{contributor, email, contested: already},
	);
};

/** Retracts a link; only its author or the contributor it names may. */
export const unlinkContributorEmail = async (
	input: LinkInput,
): Promise<Result<{contributor: string; email: string}>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const email = normalizeEmail(input.email);
	const contributor = input.contributorId ?? ready.value.actor.userId;
	const link = ready.value.state.emailLinks[emailLinkKey(email, contributor)];

	if (!link || link.tombstoned) {
		return failed(`No such link: ${email} to ${contributor}`);
	}

	// Checked at the door as well as in the handler, so the caller is told why
	// rather than watching an event be written and silently skipped.
	if (!canRemoveEmailLink(ready.value.actor.userId, link)) {
		return failed(
			'Only whoever made a claim, or the contributor it names, may undo it',
		);
	}

	const results = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'unlink.contributor.email',
				payload: {contributor, email},
				userId: ready.value.actor.userId,
			} satisfies AppEvent<'unlink.contributor.email'>,
		],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded(`Unclaimed ${email}`, {contributor, email});
};

/** Every address the board knows and who holds it, contested ones with all claimants. */
export const listContributorEmails = async (input: ToolInput = {}) => {
	const bootResult = await bootLocal(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const {emailLinks, contributors} = stateResult.value;

	// One pass. Asking `claimantsOf` per link would walk every link once per
	// link, which is the shape that only bites on a board large enough to care.
	const byEmail = new Map<string, Set<string>>();

	for (const link of Object.values(emailLinks)) {
		if (link.tombstoned) continue;

		const claimants = byEmail.get(link.email) ?? new Set<string>();
		claimants.add(link.contributor);
		byEmail.set(link.email, claimants);
	}

	const rows = [...byEmail.entries()]
		.map(([email, claimants]) => ({
			email,
			contested: claimants.size > 1,
			claimants: [...claimants].map(id =>
				identityOf(id, contributors[id]?.name),
			),
		}))
		.sort((a, b) => a.email.localeCompare(b.email));

	const actorResult = getActor();
	const mine = isFail(actorResult)
		? []
		: emailsOf(emailLinks, actorResult.value.userId);

	// The repository's git address and its holder, which explains commits
	// attributed to someone else.
	const gitEmail = getSettingsState().gitEmail;
	const heldBy = gitEmail
		? claimantsOf(emailLinks, gitEmail).filter(
				id => isFail(actorResult) || id !== actorResult.value.userId,
		  )
		: [];

	return succeeded('Listed contributor emails', {
		emails: rows,
		mine,
		git: gitEmail
			? {
					email: gitEmail,
					linkedToMe: mine.includes(gitEmail),
					heldByOthers: heldBy.map(id =>
						identityOf(id, contributors[id]?.name),
					),
			  }
			: null,
	});
};

/** Unclaimed addresses in this repository's history, for the caller to confirm (`findEmailCandidates`). */
export const suggestOwnEmails = async (input: ToolInput = {}) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const {userId, userName} = ready.value.actor;

	// Excludes the state branch: its commits are the board's own bookkeeping.
	const branchResult = getStateBranch(ready.value.boot.repoRoot);

	const scanned = await findEmailCandidates({
		repoRoot: ready.value.boot.repoRoot,
		stateBranch: isFail(branchResult) ? undefined : branchResult.value,
		names: [userName, await readGitName(ready.value.boot.repoRoot)],
		links: ready.value.state.emailLinks,
	});
	if (isFail(scanned)) return scanned;

	const candidates = offerableCandidates(scanned.value);

	const likely = candidates.filter(candidate => candidate.looksLikeYours);

	// Every unclaimed address, likely ones first, unfiltered: a panel must be able
	// to show an old address too.
	return succeeded(
		candidates.length === 0
			? 'No unclaimed addresses in this history'
			: `${candidates.length} unclaimed address(es) in this history, ${
					likely.length > 0
						? `${likely.length} of which look like yours`
						: 'none obviously yours'
			  }. Show them to the user and link only the ones they confirm; each is a permanent event that replicates to every clone.`,
		{contributor: userId, candidates, likely: likely.length},
	);
};
