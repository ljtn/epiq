import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	bootStateFromEventLog,
	createDefaultEvents,
} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materialize} from '../lib/board/board-log.js';
import {setSuffixReplay} from '../lib/board/board-replayed.js';
import {CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState, resetState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {seededRandom} from './helpers/seeded-random.js';

// A reload that applies only the new events must land on exactly the state a
// full replay of every event does, at every split, over hostile logs.

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value as T;
};

const rank = () => unwrap(midRank());

const randomLog = (seed: number, length: number): AppEvent[] => {
	const random = seededRandom(seed);
	const pick = <T>(list: T[], missing: T): T =>
		list.length === 0 || random(8) === 0 ? missing : list[random(list.length)]!;

	const defaults = unwrap(
		createDefaultEvents({userId: 'u1', userName: 'one'}),
	) as AppEvent[];
	const lanes = defaults
		.filter(e => e.action === 'add.swimlane')
		.map(e => e.payload.id)
		.filter(id => id !== CLOSED_SWIMLANE_ID);

	let n = 0;
	const id = () =>
		`01J${String(seed).padStart(4, '0')}${String(++n).padStart(19, '0')}`;
	const tickets: string[] = [];
	const tags: string[] = [];
	const people: string[] = [];
	const log: AppEvent[] = [...defaults];
	const event = (action: string, payload: object) =>
		({id: id(), action, payload, userId: 'u1'} as AppEvent);

	for (let index = 0; index < length; index++) {
		const lane = pick(lanes, 'no-such-lane');
		const ticket = pick(tickets, 'no-such-ticket');

		switch (random(12)) {
			case 0:
			case 1: {
				const created = id();
				tickets.push(created);
				log.push({
					...event('add.issue', {}),
					id: created,
					payload: {id: created, name: `T${index}`, parent: lane, rank: rank()},
				} as AppEvent);
				break;
			}
			case 2:
				log.push(event('move.node', {id: ticket, parent: lane, rank: rank()}));
				break;
			case 3:
				log.push(event('edit.title', {id: ticket, name: `Renamed ${index}`}));
				break;
			case 4: {
				const tag = id();
				tags.push(tag);
				log.push({
					...event('create.tag', {}),
					id: tag,
					payload: {id: tag, name: `tag${index}`},
				} as AppEvent);
				break;
			}
			case 5:
				log.push(
					event('add.issue.tag', {id: ticket, tag: pick(tags, 'no-such-tag')}),
				);
				break;
			case 6: {
				const person =
					random(2) === 0 || people.length === 0 ? id() : pick(people, id());
				const action = people.includes(person)
					? 'rename.contributor'
					: 'create.contributor';
				people.push(person);
				log.push({
					...event(action, {}),
					payload: {id: person, name: `p${index}`},
				} as AppEvent);
				break;
			}
			case 7:
				log.push(
					event('add.issue.comment', {
						id: id(),
						issue: ticket,
						author: 'u1',
						md: `c${index}`,
					}),
				);
				break;
			case 8:
				log.push(event('delete.node', {id: ticket}));
				break;
			case 9:
				log.push(
					random(2) === 0
						? event('close.issue', {
								id: ticket,
								parent: CLOSED_SWIMLANE_ID,
								rank: rank(),
						  })
						: event('reopen.issue', {id: ticket, parent: lane, rank: rank()}),
				);
				break;
			case 10:
				// A forged second genesis, which every replay must skip.
				log.push(
					event('init.workspace', {id: id(), name: 'Forged', rank: rank()}),
				);
				break;
			default: {
				// The same id again, carrying something else.
				const earlier = log[random(log.length)]!;
				log.push({
					...earlier,
					payload: {...(earlier.payload as object), name: `Dup ${index}`},
				} as AppEvent);
			}
		}
	}

	return log;
};

// The state events derive; UI fields such as the cursor are the caller's.
const derived = (): string => {
	const state = getState();
	const sorted = (value: unknown): unknown =>
		value && typeof value === 'object'
			? Array.isArray(value)
				? value.map(sorted)
				: Object.fromEntries(
						Object.keys(value)
							.sort()
							.map(key => [
								key,
								sorted((value as Record<string, unknown>)[key]),
							]),
				  )
			: value;

	return JSON.stringify(
		sorted({
			nodes: state.nodes,
			comments: state.comments,
			attachments: state.attachments,
			contributors: state.contributors,
			tags: state.tags,
			goals: state.goals,
			repos: state.repos,
			emailLinks: state.emailLinks,
			eventLog: state.eventLog,
			children: Object.fromEntries(
				Object.entries(state.renderedChildrenIndex).map(([parent, list]) => [
					parent,
					list.map(node => node.id),
				]),
			),
		}),
	);
};

const bootMessage = (events: AppEvent[]): string => {
	const result = bootStateFromEventLog(events);
	if (isFail(result)) throw new Error(result.message);
	return result.message;
};

beforeAll(() => {
	setVirtualNodesEnabled(false);
	unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
});

afterEach(() => {
	setSuffixReplay(false);
});

describe('a reload that only adds to the log', () => {
	it('lands where a full replay does, at every split, after an own write', () => {
		setSuffixReplay(true);
		let extended = 0;
		let splits = 0;

		for (let seed = 1; seed <= 25; seed++) {
			const events = randomLog(seed, 50);

			for (let split = 8; split < events.length - 1; split++) {
				splits++;

				unwrap(resetState());
				bootMessage(events.slice(0, split));
				// This process's own write, applied live as the GUI applies one.
				if (events[split]!.action !== 'init.workspace') {
					materialize(events[split]!);
				}
				if (bootMessage(events).startsWith('State extended')) extended++;
				const incremental = derived();

				unwrap(resetState());
				bootMessage(events);
				expect(incremental).toBe(derived());
			}
		}

		// Most splits take the suffix path, or this proved nothing.
		expect(extended).toBeGreaterThan(splits / 2);
	});

	// A newly synced duplicate of an id can sort ahead of the one applied: the
	// same id at the same place, carrying something else.
	it('replays in full when an applied event now reads differently', () => {
		setSuffixReplay(true);
		const events = randomLog(3, 40);
		const at = events.findIndex(
			(e, index) => index > 10 && e.action === 'add.issue',
		);
		const reread = events.map((e, index) =>
			index === at
				? ({
						...e,
						payload: {...(e.payload as object), name: 'Reread'},
				  } as AppEvent)
				: e,
		);

		unwrap(resetState());
		bootMessage(events.slice(0, 30));
		expect(bootMessage(reread)).toBe('State booted successfully');
		const incremental = derived();

		unwrap(resetState());
		bootMessage(reread);
		expect(incremental).toBe(derived());
	});

	it('replays in full where it was not allowed, as the TUI does', () => {
		const events = randomLog(99, 40);

		unwrap(resetState());
		bootMessage(events.slice(0, 20));
		expect(bootMessage(events)).toBe('State booted successfully');
	});

	it('replays in full after a change the log does not hold', () => {
		setSuffixReplay(true);
		const events = randomLog(7, 40);

		unwrap(resetState());
		bootMessage(events.slice(0, 20));
		const preview = events.slice(0, 20).find(e => e.action === 'add.issue')!;
		materialize(
			{
				...preview,
				action: 'edit.title',
				payload: {id: preview.payload.id, name: 'Preview'},
			} as AppEvent,
			true,
		);

		expect(bootMessage(events)).toBe('State booted successfully');
	});
});
