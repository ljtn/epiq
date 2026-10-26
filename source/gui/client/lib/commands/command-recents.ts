import {useState} from 'react';

/** The commands this browser reached for last, most recent first; capped. */
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
