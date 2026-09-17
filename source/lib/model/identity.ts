import {getStringColor} from '../utils/color.js';

/**
 * A contributor, tag or node as something to show: who it is, what to call it,
 * and the colour that follows from the name.
 *
 * The colour is resolved here rather than on a client because `getStringColor`
 * reaches into the tag defaults, which is Node-side.
 */
export type Identity = {id: string; name: string; color: string};

/**
 * What to show for an id, given whatever the registry knows about it.
 *
 * One function because the fallback is a decision rather than a detail, and it
 * was being made four different ways: the id, the empty string, `'unknown'`
 * and `'Unknown'`. The last two are worse than the id — they are a name two
 * people can share, so two strangers merge into one face in a filter list and
 * one colour on a chart, while an id is ugly and true.
 *
 * An empty or missing name is the same as no name: `tombstone.contributor`
 * clears to a placeholder rather than to nothing, so blank here means the
 * registry has never heard of this id; whether a caller tries the log's file
 * names before falling back here is `loadActorNames`'s rule.
 */
export const nameOf = (id: string, name?: string | null): string =>
	name?.length ? name : id;

export const identityOf = (id: string, name?: string | null): Identity => {
	const label = nameOf(id, name);

	return {id, name: label, color: getStringColor(label)};
};
