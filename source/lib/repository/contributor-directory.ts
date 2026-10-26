import {AppEvent} from '../board/board-events.model.js';
import {Contributor} from '../model/app-state.model.js';
import {normalizeEmail} from '../model/email-link.js';
import {Identity, identityOf} from '../model/identity.js';

/**
 * A commit's author for display, and whether it is a board identity. The flag
 * is stated, not inferred from names matching.
 */
export type CommitAuthor = Identity & {resolved: boolean};

export type DirectoryEntry = {
	id: string;
	name: string;
	/** Authored none of the given events; derived, never stored. */
	isExternal: boolean;
};

/**
 * Everyone a board knows of: the given events' authors plus the whole
 * registry. Every surface must agree, or a miss mints a duplicate id.
 */
export const contributorDirectory = ({
	events,
	registry,
	logFileNames,
}: {
	events: readonly AppEvent[];
	registry: Record<string, Contributor>;
	logFileNames?: ReadonlyMap<string, string>;
}): DirectoryEntry[] => {
	const byId = new Map<string, string>(logFileNames);
	const authorIds = new Set<string>();

	for (const event of events) {
		if (!event.userId) continue;

		if (!byId.has(event.userId)) byId.set(event.userId, '');
		authorIds.add(event.userId);
	}

	// The registry always wins: it is the source of truth for display names, and
	// a file name is a sanitized storage key that a rename leaves stale.
	for (const contributor of Object.values(registry)) {
		byId.set(contributor.id, contributor.name);
	}

	return [...byId.entries()].map(([id, name]) => ({
		id,
		name,
		isExternal: !authorIds.has(id),
	}));
};

/**
 * A commit's author: the contributor owning the address, else the raw git
 * name (unclaimed, missing or contested address).
 */
export const commitAuthorIdentity = ({
	authorName,
	authorEmail,
	owners,
	registry,
}: {
	authorName: string;
	authorEmail: string;
	/** Address to sole owner, from `emailOwnerIndex`; prebuilt, as this runs per commit. */
	owners: ReadonlyMap<string, string>;
	registry: Record<string, Contributor>;
}): CommitAuthor => {
	const email = normalizeEmail(authorEmail);
	const owner = owners.get(email);
	const contributor = owner ? registry[owner] : undefined;

	// A claimed address whose contributor the registry has lost still resolves to
	// that id: `identityOf` prefers an ugly, true id over a shared placeholder.
	if (owner) return {...identityOf(owner, contributor?.name), resolved: true};

	// The address, not the name, stands in as the id, so namesakes don't merge.
	return {...identityOf(email || authorName, authorName), resolved: false};
};
