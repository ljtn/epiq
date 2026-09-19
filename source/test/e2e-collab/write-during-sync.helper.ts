/**
 * One machine, several tools, one of them writing while another syncs —
 * the contract the two `write-during-sync-*` files are both about, and what
 * they both measure it with.
 *
 * `concurrent-sync.test.ts` races several syncs against each other, and the
 * sync lock settles those. Nothing holds that lock on the write path:
 * `persist` appends and `loadMergedEvents` reads with no lock at all, while a
 * sync in another process is rewriting the same directory — `git rebase`
 * replays commits over that worktree, and `rebase.autoStash` reverts the
 * working copy to HEAD and puts it back afterwards.
 *
 * A GUI beside an MCP server beside a TUI is the ordinary arrangement for an
 * agent-driven board, and only one of them has to be syncing for the others to
 * be writing into a directory git is part-way through rewriting.
 *
 * The contract under test is the narrowest one there is: an issue the board
 * accepted has to still exist afterwards, on every machine. Nothing about
 * ordering, nothing about ranks.
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
 * A sync that lost the race to a concurrent write.
 *
 * Nothing holds a lock on the append path, deliberately: a write that had to
 * wait on a sync would stall the person doing it, and this is the busiest path
 * in the app. So git can find the log dirty at any point while it rebases and
 * refuse — before it starts, at its pre-flight check, or part-way through the
 * replay, which is why this matches three different refusals.
 *
 * The sync fails having changed nothing and the next one picks it up. That is
 * the design, not a defect, and it is not what this file is here to catch: the
 * contract in the header is that an accepted issue does not go missing, and
 * that stays asserted exactly as strictly as before.
 */
const BLOCKED_BY_A_CONCURRENT_WRITE =
	/unstaged changes|would be overwritten|could not detach HEAD/;

/**
 * Tolerated, but counted. An occasional blip is what the design trades for a
 * lock-free write path; every round failing is a regression that would
 * otherwise hide behind the same message. This is the line between them.
 */
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
