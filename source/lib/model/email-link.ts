/**
 * A git author address bound to a contributor. Pure over links only, since
 * replay applies these rules and every replica must agree.
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
 * FROZEN: every stored link is matched through this, so a change silently
 * unmatches them all. Lowercasing the local part is a deliberate trade.
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
 * A space can't appear in either half; a control character would make source
 * files binary to git.
 */
export const emailLinkKey = (email: string, contributor: string): string =>
	`${normalizeEmail(email)} ${contributor}`;

const live = (link: EmailLink): boolean => !link.tombstoned;

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
 * Address to sole owner. Contested addresses are absent, not null, so a caller
 * that forgets falls back to the raw author.
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
 * Whether this contributor retracted this address before, tombstones included,
 * so the auto-link never silently undoes a retraction.
 */
export const wasRetractedBy = (
	links: Readonly<Record<string, EmailLink>>,
	email: string,
	contributor: string,
): boolean => links[emailLinkKey(email, contributor)]?.tombstoned === true;

/**
 * Who may retract a link: whoever wrote it, or whoever it points at. An
 * address's owner can't strip another's claim, only co-claim it.
 */
export const canRemoveEmailLink = (actorId: string, link: EmailLink): boolean =>
	actorId === link.authorId || actorId === link.contributor;
