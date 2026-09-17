import {AppEvent} from '../board/board-events.model.js';
import {Contributor} from '../model/app-state.model.js';

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
