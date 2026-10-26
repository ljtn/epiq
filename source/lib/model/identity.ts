import {getStringColor} from '../utils/color.js';

/**
 * A contributor, tag or node as something to show. The colour is resolved here
 * because `getStringColor` is Node-side.
 */
export type Identity = {id: string; name: string; color: string};

/** The last resort when there is neither a name nor an id. */
const UNNAMED = 'Unknown';

/**
 * What to show for an id: the name, else the id, else `Unknown`. A shared name
 * like `Unknown` merges strangers, so the id wins; the id may be absent at runtime.
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
