/**
 * One tool writes, unlocked, while another syncs the same worktree: an issue
 * the board accepted must still exist afterwards, on every machine.
 */
import {expect} from 'vitest';
import {runActor, type Actor} from './harness.js';
import type {ActorReport} from './protocol.js';

export const TIMEOUT_MS = 900_000;
export const ROUNDS = 6;
// Enough commits that the rebase is still replaying when the writer starts.
export const COMMITS_PER_ROUND = 8;
export const WRITES_PER_ROUND = 20;

export const create = (n: number, by: string) =>
	Array.from({length: n}, (_, index) => ({
		kind: 'create' as const,
		title: `${by}-${index}`,
	}));

export const titlesIn = (report: ActorReport): Set<string> =>
	new Set(report.issues.map(entry => entry.split('\t')[1] ?? ''));

/** Titles the board accepted — a refused create is not a lost one. */
export const acceptedTitles = (
	report: ActorReport,
	expected: string[],
): string[] => {
	const refused = report.problems.filter(problem =>
		problem.startsWith('create:'),
	);

	return refused.length > 0 ? [] : expected;
};

/**
 * A sync that lost the race to an unlocked concurrent write; git refuses at any
 * of three points. By design: the next sync picks it up.
 */
const BLOCKED_BY_A_CONCURRENT_WRITE =
	/unstaged changes|would be overwritten|could not detach HEAD/;

/** Lost races are tolerated up to this; every round failing is a regression. */
export const MAX_BLOCKED_SYNCS = 4;

// Anything that is neither of the two known, expected outcomes. One of these
// fails the round it appears in, on its first occurrence.
export const unexpectedProblems = (problems: string[]): string[] =>
	problems.filter(
		problem =>
			!/Another process is syncing/.test(problem) &&
			!BLOCKED_BY_A_CONCURRENT_WRITE.test(problem),
	);

export const blockedSyncs = (problems: string[]): number =>
	problems.filter(problem => BLOCKED_BY_A_CONCURRENT_WRITE.test(problem))
		.length;

export const publishRemoteWork = async (
	peer: Actor,
	round: number,
): Promise<void> => {
	for (let commit = 0; commit < COMMITS_PER_ROUND; commit += 1) {
		const published = await runActor(peer, {
			actions: create(2, `peer-r${round}c${commit}`),
			sync: true,
		});

		expect(published.problems, `peer publishing r${round}c${commit}`).toEqual(
			[],
		);
	}
};
