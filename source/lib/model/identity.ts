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
 * The last resort, for a subject with neither a name nor an id to fall back to.
 * A name two people can share, which is why it is last: an id is ugly and true,
 * and this is only for when there is no id either.
 */
const UNNAMED = 'Unknown';

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
 *
 * And a missing id: `add.issue.comment` leaves `author` unconstrained on
 * purpose — this board's log holds an attachment written without one — so the
 * id can be absent at runtime whatever the type says. Answered here rather than
 * at each call site, because a caller that forgets returns `undefined` as
 * somebody's name, which is what `getIssueComments` did.
 */
export const nameOf = (id: string | undefined, name?: string | null): string =>
	name?.length ? name : id?.length ? id : UNNAMED;

export const identityOf = (
	id: string | undefined,
	name?: string | null,
): Identity => {
	const label = nameOf(id, name);

	return {
		id: id?.length ? id : label,
		name: label,
		color: getStringColor(label),
	};
};
