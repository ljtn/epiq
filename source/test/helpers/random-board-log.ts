// Hostile board logs and the state they derive, for tests that compare two
// ways of materializing the same events.

import {createDefaultEvents} from '../../lib/board/board-boot.js';
import {AppEvent} from '../../lib/board/board-events.model.js';
import {repoIdOf} from '../../lib/board/board-repos.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/board/static-ids.js';
import {isFail, Result} from '../../lib/model/result-types.js';
import {getState} from '../../lib/state/state.js';
import {midRank} from '../../lib/utils/rank.js';
import {seededRandom} from './seeded-random.js';

export const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value as T;
};

export const rank = () => unwrap(midRank());

export const randomLog = (seed: number, length: number): AppEvent[] => {
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

		switch (random(13)) {
			case 12: {
				// A few repos, connected, relabelled and dropped again.
				const url = `https://example.com/repo${random(3)}.git`;
				const kind = random(3);
				log.push(
					kind === 0
						? event('connect.repo', {url, label: `r${index}`})
						: kind === 1
						? event('edit.repo', {repo: repoIdOf(url), label: `e${index}`})
						: event('disconnect.repo', {repo: repoIdOf(url)}),
				);
				break;
			}
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
export const derived = (): string => {
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
			authors: state.authors,
			actorsById: state.actorsById,
			children: Object.fromEntries(
				Object.entries(state.renderedChildrenIndex).map(([parent, list]) => [
					parent,
					list.map(node => node.id),
				]),
			),
		}),
	);
};
