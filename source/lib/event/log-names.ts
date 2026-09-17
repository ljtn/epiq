import {
	Contributor,
	REMOVED_CONTRIBUTOR_NAME,
} from '../model/app-state.model.js';
import {AppEvent} from './event.model.js';

/**
 * What everything in the log is currently called, derived from the log alone.
 *
 * The materialized board answers this from its registries, and every reader
 * that has booted one should ask it rather than this. This exists for the one
 * reader that must not: `getEventTimeline` is a pure read that stays correct
 * mid-scrub, so it cannot touch the state singleton, and it still has to put a
 * name on an actor, a tag and a lane.
 *
 * It is therefore a second implementation of rules that live in `node-repo`,
 * which is the shape a drift comes in. `log-names.test.ts` pins it against
 * `bootStateFromEventLog` over a log that exercises every naming event, so the
 * two cannot disagree without a test saying so.
 *
 * The *current* name, not the name in force when each event was written. The
 * registry has been the source of truth for display names since SVYYX5A, and
 * since ZFZFW9D no event carries a name at all — a rename is meant to show on
 * the lines written before it as well as after. Reading each event under the
 * name its subject was created with undid both, and, worse, ignored
 * `tombstone.contributor` outright: a name cleared on request stayed on every
 * line in the timeline.
 */
export type LogNames = {
	/** Contributors, tags, boards and swimlanes, by id. */
	byId: ReadonlyMap<string, string>;
	/**
	 * The swimlanes alone, which a timeline hands to its client so a lane the
	 * board has since deleted can still be named on a chart drawn from its
	 * history.
	 */
	lanes: Readonly<Record<string, string>>;
};

type NamedPayload = {id?: string; name?: string};

const payloadOf = (event: AppEvent): NamedPayload =>
	(event.payload ?? {}) as NamedPayload;

export const projectLogNames = (events: AppEvent[]): LogNames => {
	const byId = new Map<string, string>();
	const lanes: Record<string, string> = {};

	// Only for `rename.contributor`, which `node-repo` refuses on a tombstoned
	// record so that a rename cannot quietly undo a removal. Nothing else needs
	// the flag: a tag keeps its name through a tombstone, and a restore carries
	// the name to go back to.
	const tombstoned = new Set<string>();

	// Nodes carry their name in `add.*` and change it with `edit.title`, which
	// every other kind of node uses too — so a title edit only counts as a
	// rename for an id one of those created.
	const nodes = new Set<string>();

	for (const event of events) {
		const {id, name} = payloadOf(event);
		if (!id) continue;

		switch (event.action) {
			case 'create.contributor':
			case 'create.tag':
				if (name) byId.set(id, name);
				break;

			// Refused on a record that does not exist, and on a tombstoned one.
			case 'rename.contributor':
				if (name && byId.has(id) && !tombstoned.has(id)) byId.set(id, name);
				break;

			// Clears the name and keeps the record, so an assignment referencing
			// the id still resolves — to the placeholder, deliberately.
			case 'tombstone.contributor':
				if (byId.has(id)) {
					byId.set(id, REMOVED_CONTRIBUTOR_NAME);
					tombstoned.add(id);
				}
				break;

			case 'restore.contributor':
			case 'restore.tag':
				if (name && byId.has(id)) {
					byId.set(id, name);
					tombstoned.delete(id);
				}
				break;

			// A board is named because a swimlane moved between two of them says
			// which, but it is not a lane and does not belong in the lane index.
			case 'add.board':
				if (name) {
					byId.set(id, name);
					nodes.add(id);
				}
				break;

			case 'add.swimlane':
				if (name) {
					byId.set(id, name);
					nodes.add(id);
					lanes[id] = name;
				}
				break;

			case 'edit.title':
				if (name !== undefined && nodes.has(id)) {
					byId.set(id, name);
					if (id in lanes) lanes[id] = name;
				}
				break;

			default:
				break;
		}
	}

	return {byId, lanes};
};

/**
 * The same projection as a contributor registry, for comparing against a booted
 * board. Only the fields this derives — a record here is a name and whether it
 * was tombstoned, never an assignment.
 */
export const contributorNamesIn = (
	registry: Record<string, Contributor>,
): Map<string, string> =>
	new Map(Object.values(registry).map(({id, name}) => [id, name]));
