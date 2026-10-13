import {afterEach, describe, expect, it} from 'vitest';
import {repoIdOf} from '../../lib/board/board-repos.js';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Collaboration,
} from './harness.js';
import type {ActorAction, ActorReport} from './protocol.js';

const TIMEOUT_MS = 240_000;

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

const X = 'https://example.com/team/x.git';
const Y = 'https://example.com/team/y.git';
const Z = 'https://example.com/team/z.git';

const connect = (url: string, options: object = {}): ActorAction => ({
	kind: 'repo',
	event: {action: 'connect.repo', payload: {url, ...options}},
});
const edit = (url: string, options: object): ActorAction => ({
	kind: 'repo',
	event: {action: 'edit.repo', payload: {repo: repoIdOf(url), ...options}},
});
const disconnect = (url: string): ActorAction => ({
	kind: 'repo',
	event: {action: 'disconnect.repo', payload: {repo: repoIdOf(url)}},
});

const liveOf = (report: ActorReport) =>
	(
		JSON.parse(report.repos) as {
			live: {id: string; label: string; since: string}[];
		}
	).live;

describe('connected repos across machines', () => {
	it(
		'lands every machine on the same list after racing connects, edits and disconnects',
		async () => {
			const collab = await startCollaboration({names: ['a', 'b', 'c']});
			running = collab;
			const [a, b, c] = collab.actors as [
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
			];

			expect(
				(await runActor(a, {init: true, actions: [], sync: true})).problems,
			).toEqual([]);
			for (const actor of [b, c]) {
				expect(
					(await runActor(actor, {actions: [], sync: true})).problems,
				).toEqual([]);
			}

			// Nobody syncs between these: each machine writes against what it has.
			const writes = [
				await runActor(a, {actions: [connect(X, {label: 'api'})], sync: false}),
				await runActor(b, {
					actions: [connect(Y, {label: 'api'}), connect(X, {since: 'all'})],
					sync: false,
				}),
				await runActor(c, {
					actions: [connect(Z), disconnect(Z), connect(X, {label: 'ex'})],
					sync: false,
				}),
			];
			for (const write of writes) expect(write.problems).toEqual([]);

			for (const actor of [a, b, c, a, b]) {
				expect(
					(await runActor(actor, {actions: [], sync: true})).problems,
				).toEqual([]);
			}

			const first = await Promise.all(
				[a, b, c].map(actor => runActor(actor, {actions: [], sync: false})),
			);
			expect(first[1]!.repos).toEqual(first[0]!.repos);
			expect(first[2]!.repos).toEqual(first[0]!.repos);
			expect(first[1]!.orderedEventIds).toEqual(first[0]!.orderedEventIds);

			const live = liveOf(first[0]!);
			expect(live.map(repo => repo.id).sort()).toEqual(
				[repoIdOf(X), repoIdOf(Y)].sort(),
			);
			// One label each, and every option the racing writers set is kept.
			expect(new Set(live.map(repo => repo.label)).size).toBe(2);
			expect(live.find(repo => repo.id === repoIdOf(X))?.since).toBe('all');

			// Now that both have seen X: a disconnect racing an edit of it.
			expect(
				(await runActor(a, {actions: [disconnect(X)], sync: false})).problems,
			).toEqual([]);
			expect(
				(
					await runActor(b, {
						actions: [edit(X, {since: '2025-01-01'})],
						sync: false,
					})
				).problems,
			).toEqual([]);

			for (const actor of [a, b, c, a, b]) {
				expect(
					(await runActor(actor, {actions: [], sync: true})).problems,
				).toEqual([]);
			}

			const second = await Promise.all(
				[a, b, c].map(actor => runActor(actor, {actions: [], sync: false})),
			);
			expect(second[1]!.repos).toEqual(second[0]!.repos);
			expect(second[2]!.repos).toEqual(second[0]!.repos);
			expect(liveOf(second[0]!).map(repo => repo.id)).not.toContain(
				repoIdOf(X),
			);
		},
		TIMEOUT_MS,
	);
});
