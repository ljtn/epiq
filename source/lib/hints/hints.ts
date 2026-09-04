import {ActionEntry, ModeUnion} from '../model/action-map.model.js';

// One keyboard shortcut as the bottom bar and the help screen show it, parsed
// from an action description of the form `[keys] label`.
export type ActionHint = {keys: string; label: string};

export const parseActionHint = (description: string): ActionHint | null => {
	const match = /^\[(.+?)\]\s*(.+)$/.exec(description);
	if (!match) return null;

	return {keys: match[1] ?? '', label: match[2] ?? ''};
};

// Single keys first, then chords and key groups; stable within each rank, so
// the declaration order of the actions is the order the bar reads in.
const rankOf = ({keys}: ActionHint): number => (keys.length === 1 ? 0 : 1);

export const getActionHints = (
	actions: ActionEntry[],
	mode: ModeUnion,
): ActionHint[] => {
	const descriptions = new Set<string>();

	for (const action of actions) {
		if (action.mode !== mode || !action.description) continue;

		descriptions.add(action.description);
	}

	return [...descriptions]
		.map(parseActionHint)
		.filter((hint): hint is ActionHint => hint !== null)
		.sort((a, b) => rankOf(a) - rankOf(b));
};
