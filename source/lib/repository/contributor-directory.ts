import {AppEvent} from '../board/board-events.model.js';
import {Contributor} from '../model/app-state.model.js';
import {normalizeEmail} from '../model/email-link.js';
import {Identity, identityOf} from '../model/identity.js';

export type DirectoryEntry = {
	id: string;
	name: string;
	/**
	 * Has not authored any of the events given. Board-scoped where the caller
	 * scoped the events, so it means "has not worked on this board", not "is not
	 * in the history" — and it is derived, never stored, so it self-corrects.
	 */
	isExternal: boolean;
};

/**
 * Everyone a board knows of: the authors of the events given, plus the whole
 * contributor registry.
 *
 * One function because every surface that offers or matches a contributor has
 * to reach the same answer. Where two of them disagree, a name typed at one of
 * them finds no candidate, and the caller's next move is `createUnlinked` —
 * which mints a second id for somebody who already has one, as a real event, on
 * every clone. That failure is what `ZFZFW9D` widened the blast radius of and
 * what this exists to prevent.
 *
 * `logFileNames` names an author the registry has never heard of; see
 * `loadActorNames` for who takes that fallback and why.
 *
 * Membership is the workspace, not the board — the registry already holds
 * people who have never touched this one — and only `isExternal` is scoped to
 * the events given. Matching too widely picks an id that exists; matching too
 * narrowly mints one that should not.
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
 * What to show for a commit's author: the contributor whose address it is, or
 * the raw git name.
 *
 * Here rather than beside the git reader, because "who is this" is this
 * module's question and answering it twice is the drift it exists to prevent. A
 * matched author comes back through `identityOf`, so it carries the same name
 * and the same colour as the same person does everywhere else on the board.
 *
 * Unmatched covers three cases that all render identically, and deliberately:
 * nobody has claimed the address, the commit carries no address at all, and two
 * contributors claim it so it resolves to neither. Falling back to the raw name
 * is what the board does today, so nothing regresses for anyone who never links
 * anything.
 */
export const commitAuthorIdentity = ({
	authorName,
	authorEmail,
	owners,
	registry,
}: {
	authorName: string;
	authorEmail: string;
	/**
	 * Address to sole owner, from `emailOwnerIndex`. Taken already built rather
	 * than derived from the links here: this runs once per commit, and building
	 * it inside would walk every link on the board for every commit drawn.
	 */
	owners: ReadonlyMap<string, string>;
	registry: Record<string, Contributor>;
}): Identity => {
	const email = normalizeEmail(authorEmail);
	const owner = owners.get(email);
	const contributor = owner ? registry[owner] : undefined;

	// A claimed address whose contributor the registry has lost still resolves to
	// that id: `identityOf` prefers an ugly, true id over a shared placeholder.
	if (owner) return identityOf(owner, contributor?.name);

	// Not `identityOf(undefined, name)`, which would use the name as the id and
	// merge two committers who happen to share one. An unmatched author is not a
	// board identity at all, so the address stands in as its id.
	return identityOf(email || authorName, authorName);
};
