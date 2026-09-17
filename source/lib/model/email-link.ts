/**
 * A git author address bound to a contributor, so a commit and a board event
 * written by one person read as one person.
 *
 * The rules here are pure and depend only on links, never on who is asking or
 * on anything off disk. `board-materialize` applies them during replay, where a
 * predicate that is not a function of the ordered log would let two replicas
 * derive different boards.
 */

export type EmailLink = {
	/** Normalized by `normalizeEmail`, which is the form that is stored. */
	email: string;
	contributor: string;
	/** Who wrote the link. Half of who is allowed to remove it. */
	authorId: string;
	tombstoned?: boolean;
};

/**
 * FROZEN. The stored form of an address is whatever this returns, so every
 * link ever written is matched through it. Changing it stops existing links
 * matching, silently and everywhere, with no error and nothing to migrate —
 * the same trap the log file name's grammar is, for the same reason.
 *
 * Lowercasing the local part is lossy: RFC 5321 leaves it case-sensitive. It
 * is right for git and the forges people actually use, where addresses are
 * compared case-insensitively, and it is a deliberate trade rather than an
 * oversight.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** A plausible address, only to keep obvious rubbish out of the log. */
export const isValidEmail = (value: string): boolean => {
	const email = normalizeEmail(value);
	return (
		email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email)
	);
};

/**
 * A space separates the two halves, and cannot appear in either: a stored
 * address has been through `isValidEmail`, which rejects whitespace, and a
 * contributor id is Crockford base32. A control character would be the obvious
 * separator and is not worth it — one in a source file makes it binary to git,
 * so `diff`, `blame` and `grep` all quietly stop working on it.
 */
export const emailLinkKey = (email: string, contributor: string): string =>
	`${normalizeEmail(email)} ${contributor}`;

const live = (link: EmailLink): boolean => !link.tombstoned;

/**
 * Who an address belongs to, or nobody.
 *
 * Nobody covers two cases that render the same way: no one has claimed it, and
 * more than one contributor has. The second is deliberate — a contested
 * address is genuinely ambiguous, and naming one of the claimants would be
 * confidently wrong rather than merely unhelpful. It is reachable without an
 * attacker, when two people share a git `user.email`, so `WABMTYY` gives it a
 * name in the UI instead of leaving it silent.
 */
export const resolveEmailOwner = (
	links: Readonly<Record<string, EmailLink>>,
	email: string,
): string | undefined => {
	const claimants = claimantsOf(links, email);
	return claimants.length === 1 ? claimants[0] : undefined;
};

/** Every contributor currently claiming an address, in no particular order. */
export const claimantsOf = (
	links: Readonly<Record<string, EmailLink>>,
	email: string,
): string[] => {
	const wanted = normalizeEmail(email);
	const ids = new Set<string>();

	for (const link of Object.values(links)) {
		if (live(link) && link.email === wanted) ids.add(link.contributor);
	}

	return [...ids];
};

/** The addresses a contributor currently claims. */
export const emailsOf = (
	links: Readonly<Record<string, EmailLink>>,
	contributor: string,
): string[] => {
	const emails = new Set<string>();

	for (const link of Object.values(links)) {
		if (live(link) && link.contributor === contributor) emails.add(link.email);
	}

	return [...emails];
};

/**
 * Address to sole owner, for matching a batch of commits without walking every
 * link per commit. Contested addresses are absent rather than present-and-null,
 * so a caller that forgets the distinction falls back to the raw author string.
 */
export const emailOwnerIndex = (
	links: Readonly<Record<string, EmailLink>>,
): Map<string, string> => {
	const contributorsByEmail = new Map<string, Set<string>>();

	for (const link of Object.values(links)) {
		if (!live(link)) continue;

		const claimants = contributorsByEmail.get(link.email) ?? new Set<string>();
		claimants.add(link.contributor);
		contributorsByEmail.set(link.email, claimants);
	}

	const index = new Map<string, string>();

	for (const [email, claimants] of contributorsByEmail) {
		const [only] = [...claimants];
		if (claimants.size === 1 && only) index.set(email, only);
	}

	return index;
};

/**
 * Who may retract a link: whoever wrote it, or whoever it points at.
 *
 * Deliberately not "anybody", which would let one writer strip every link on
 * the board as often as they liked. Deliberately not "the author alone", which
 * would leave somebody stuck with a link a colleague made for them.
 *
 * It does not let the owner of an address remove somebody else's claim on it,
 * so a squatted address cannot be reclaimed — only co-claimed, which makes it
 * contested and stops it resolving to the squatter. Reclaiming and stripping
 * are the same capability, and separating them needs proof that an address is
 * yours, which means signed commits. `4NENX8W` has the reasoning.
 */
export const canRemoveEmailLink = (actorId: string, link: EmailLink): boolean =>
	actorId === link.authorId || actorId === link.contributor;
