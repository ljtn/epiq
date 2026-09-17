import {AppEvent} from '../event/event.model.js';
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
 * `logFileNames` is the fallback for an author the registry has never heard of,
 * which since v1.5.0 means one who last wrote before it: their only name
 * anywhere is the segment of their old log's file name. `KHT69TD` asks whether
 * that fallback should exist at all; until it is answered it lives here, once.
 *
 * Membership is the workspace, not the board: everyone in the registry, plus
 * everyone a log file names, plus the authors of the events given. Only
 * `isExternal` is scoped to those events. The registry was already whole — a
 * contributor who has never touched this board is in it — so narrowing the
 * file-name half alone would have been inconsistent, and it would have been
 * inconsistent in the expensive direction: a name that fails to match here is
 * one `createUnlinked` away from a second id for somebody who already has one,
 * while a name that matches too widely only ever picks an id that exists.
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

/** The directory as a name lookup, for callers matching rather than listing. */
export const namesInDirectory = (
	entries: readonly DirectoryEntry[],
): Map<string, string> => new Map(entries.map(({id, name}) => [id, name]));
