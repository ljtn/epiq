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
import {readGitName} from '../../lib/config/git-identity.js';
import {getSettingsState} from '../../lib/state/settings.state.js';
import {getCommitTimeline} from '../epiq-time-travel.js';
import {ToolInput, boot, getActor, getStateResult} from './boot.js';

type LinkInput = ToolInput & {email: string; contributorId?: string};

/**
 * Binds a git address to a contributor, defaulting to whoever is asking.
 *
 * `contributorId` is accepted so somebody can link a colleague who does not use
 * epiq — without that their commits never resolve at all. Retracting is the
 * narrow half: see `unlinkContributorEmail`.
 */
export const linkContributorEmail = async (
	input: LinkInput,
): Promise<
	Result<{contributor: string; email: string; contested: string[]}>
> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	if (!isValidEmail(input.email)) {
		return failed(`Not an email address: ${input.email}`);
	}

	const email = normalizeEmail(input.email);
	const contributor = input.contributorId ?? actorResult.value.userId;

	if (!stateResult.value.contributors[contributor]) {
		return failed(`Unknown contributor: ${contributor}`);
	}

	const already = claimantsOf(stateResult.value.emailLinks, email);
	if (already.includes(contributor)) {
		return succeeded('Email already linked', {
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
				userId: actorResult.value.userId,
			} satisfies AppEvent<'link.contributor.email'>,
		],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	// Reported rather than refused: a second claim is legal, and the caller is
	// the one who can tell a shared team address from a mistake.
	return succeeded(
		already.length > 0
			? 'Linked, but the address is now claimed by more than one contributor and resolves to none of them'
			: 'Linked email to contributor',
		{contributor, email, contested: already},
	);
};

/**
 * Retracts a link, which only its author or the contributor it names may do.
 *
 * Deliberately narrower than linking. Open removal would let one writer strip
 * every link on the board as often as they liked, and the capability to remove
 * somebody else's claim is the same one that would let them remove yours.
 */
export const unlinkContributorEmail = async (
	input: LinkInput,
): Promise<Result<{contributor: string; email: string}>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const email = normalizeEmail(input.email);
	const contributor = input.contributorId ?? actorResult.value.userId;
	const link = stateResult.value.emailLinks[emailLinkKey(email, contributor)];

	if (!link || link.tombstoned) {
		return failed(`No such link: ${email} to ${contributor}`);
	}

	// Checked at the door as well as in the handler, so the caller is told why
	// rather than watching an event be written and silently skipped.
	if (!canRemoveEmailLink(actorResult.value.userId, link)) {
		return failed(
			'Only the author of a link or the contributor it names may remove it',
		);
	}

	const results = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'unlink.contributor.email',
				payload: {contributor, email},
				userId: actorResult.value.userId,
			} satisfies AppEvent<'unlink.contributor.email'>,
		],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Unlinked email from contributor', {contributor, email});
};

/**
 * Every address the board knows, and who holds it.
 *
 * Contested addresses are listed with all their claimants rather than left out,
 * because "claimed by two people and resolving to neither" is the one state
 * nothing else on the board would ever tell you about.
 */
export const listContributorEmails = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	// The address this repository's git is configured with, and who holds it.
	//
	// Without this, somebody whose own address another contributor claimed sees
	// an empty list and nothing else: the auto-link refuses to take a claimed
	// address, so it stays quiet, and the board goes on attributing their
	// commits to somebody else with no way to find out why. Naming it is the
	// whole diagnosis.
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

/**
 * Addresses in this repository's history that look like the caller's own, for
 * them to confirm.
 *
 * The auto-link only ever claims the address git is configured with now, so
 * anybody with history behind them keeps a board of raw git names. One
 * confirmation here fixes all of it at once, because a commit's author is
 * resolved when it is drawn rather than stamped on it.
 *
 * Matching cannot be equality on the name. A short board handle beside a full
 * git name is the ordinary case — "jola" and "Jonatan Lampa" — so equality
 * would offer nothing to precisely the people this exists for. Any shared word
 * counts instead, and every candidate is confirmed by a person, so a loose rule
 * costs a glance and a tight one costs the feature.
 */
const words = (value: string): string[] =>
	value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(word => word.length > 2);

export const suggestOwnEmails = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const commitsResult = await getCommitTimeline({repoRoot: input.repoRoot});
	if (isFail(commitsResult)) return failed(commitsResult.message);

	const {userId, userName} = actorResult.value;
	const gitName = await readGitName(bootResult.value.repoRoot);
	const gitEmail = getSettingsState().gitEmail;

	// Anything the board already resolves is not a candidate: an address of ours
	// needs no confirming, and one somebody else holds is theirs to keep.
	const claimed = new Set(
		Object.values(stateResult.value.emailLinks)
			.filter(link => !link.tombstoned)
			.map(link => link.email),
	);

	const mine = new Set([...words(userName), ...words(gitName ?? '')]);
	const byEmail = new Map<string, {names: Set<string>; commits: number}>();

	for (const commit of commitsResult.value) {
		const email = normalizeEmail(commit.authorEmail);

		// The configured address is linked unattended by the write path, so
		// offering it again would ask about something already handled.
		if (!email || email === gitEmail || claimed.has(email)) continue;

		const seen = byEmail.get(email) ?? {names: new Set<string>(), commits: 0};
		seen.names.add(commit.author);
		seen.commits += 1;
		byEmail.set(email, seen);
	}

	const candidates = [...byEmail.entries()]
		.map(([email, seen]) => ({
			email,
			names: [...seen.names],
			commits: seen.commits,
			// A local part matching the address itself catches "jola@" for jola,
			// which no commit name would.
			looksLikeYours:
				[...seen.names].some(name =>
					words(name).some(word => mine.has(word)),
				) || words(email.split('@')[0] ?? '').some(word => mine.has(word)),
		}))
		.filter(candidate => candidate.looksLikeYours)
		.sort((a, b) => b.commits - a.commits);

	return succeeded(
		candidates.length === 0
			? 'No unclaimed addresses in this history look like yours'
			: `Found ${candidates.length} unclaimed address(es) that look like yours. Show them to the user and link only the ones they confirm; each one is a permanent event that replicates to every clone.`,
		{contributor: userId, candidates},
	);
};
