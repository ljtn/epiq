import {REMOVED_CONTRIBUTOR_NAME} from '../model/app-state.model.js';
import {AppEvent} from './board-events.model.js';

/**
 * Current names from the log alone, for `getEventTimeline`, which can't touch
 * state. Mirrors `node-repo`'s rules; `log-names.test.ts` pins the two together.
 */
export type LogNames = {
	/** Contributors, tags, boards and swimlanes, by id. */
	byId: ReadonlyMap<string, string>;
	/** Swimlanes alone, so a since-deleted lane can still be named on a chart. */
	lanes: Readonly<Record<string, string>>;
};

type NamedPayload = {id?: string; name?: string};

const payloadOf = (event: AppEvent): NamedPayload =>
	(event.payload ?? {}) as NamedPayload;

export const projectLogNames = (events: AppEvent[]): LogNames => {
	const byId = new Map<string, string>();
	const lanes: Record<string, string> = {};

	// Separate from the names, since a contributor may be created with an empty one.
	const known = new Set<string>();

	// Only for `rename.contributor`, refused on a tombstoned record.
	const tombstoned = new Set<string>();

	// A title edit is a rename only for ids an `add.board`/`add.swimlane` created.
	const nodes = new Set<string>();

	for (const event of events) {
		const {id, name} = payloadOf(event);
		if (!id) continue;

		switch (event.action) {
			// Re-creating a contributor clears its tombstone, as `createContributor` does.
			case 'create.contributor':
			case 'create.tag':
				byId.set(id, name ?? '');
				known.add(id);
				tombstoned.delete(id);
				break;

			// Refused on a record that does not exist, and on a tombstoned one.
			case 'rename.contributor':
				if (name !== undefined && known.has(id) && !tombstoned.has(id)) {
					byId.set(id, name);
				}
				break;

			// Clears the name and keeps the record, so an assignment referencing
			// the id still resolves — to the placeholder, deliberately.
			case 'tombstone.contributor':
				if (known.has(id)) {
					byId.set(id, REMOVED_CONTRIBUTOR_NAME);
					tombstoned.add(id);
				}
				break;

			case 'restore.contributor':
			case 'restore.tag':
				if (name !== undefined && known.has(id)) {
					byId.set(id, name);
					tombstoned.delete(id);
				}
				break;

			// Named, but not a lane.
			case 'add.board':
				if (name !== undefined) {
					byId.set(id, name);
					nodes.add(id);
				}
				break;

			case 'add.swimlane':
				if (name !== undefined) {
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
