import {useState} from 'react';

/**
 * The commands this reader reached for last, most recent first.
 *
 * Per browser rather than per board, like the reviewed-file ticks and the
 * panel's dock: which commands somebody uses is a working habit, not a property
 * of the work. Capped, because the palette shows them where an empty query
 * would otherwise show the whole list in declaration order — a tail nobody
 * remembers is not a shortcut.
 */
const STORAGE_KEY = 'epiq.gui.recentCommands';

const CAP = 6;

// Anything but a list of strings — a hand edit, an older shape — reads as no
// history rather than a palette that will not open.
export const readRecentCommands = (): string[] => {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(STORAGE_KEY) ?? '[]',
		);

		return Array.isArray(parsed)
			? parsed
					.filter((entry): entry is string => typeof entry === 'string')
					.slice(0, CAP)
			: [];
	} catch {
		return [];
	}
};

// Moved to the front rather than appended, so running a command already in the
// list promotes it instead of duplicating it.
export const withCommandRemembered = (
	recent: readonly string[],
	id: string,
): string[] => [id, ...recent.filter(entry => entry !== id)].slice(0, CAP);

export type RecentCommands = {
	ids: string[];
	remember: (id: string) => void;
};

export const useRecentCommands = (): RecentCommands => {
	const [ids, setIds] = useState(readRecentCommands);

	return {
		ids,
		remember: (id: string) => {
			setIds(previous => {
				const next = withCommandRemembered(previous, id);

				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
				} catch {
					// Storage unavailable: the list still holds for this session.
				}

				return next;
			});
		},
	};
};
