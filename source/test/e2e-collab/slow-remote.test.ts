/**
 * A remote that is reachable, but slower than the 10-second cap every git
 * call in `git-utils.ts` runs under.
 *
 * The cap SIGTERMs the child and reports "Git command timed out after
 * 10000ms", and `isRemoteUnreachable` matches that string — so a slow link and
 * an absent one produce the same answer: `offline`, "Committed locally". A
 * state branch carrying a few hundred attachment blobs, a phone hotspot, or a
 * repository host having a bad minute all land here, and the board reports
 * that it saved the work locally rather than that it cannot publish.
 *
 * Simulated with git's `ext::` transport rather than a real slow network: it
 * is a genuine remote, reached by a genuine fetch, that simply takes longer
 * than the cap allows.
 */
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {execGit} from '../../git/git-utils.js';
import {isFail} from '../../lib/model/result-types.js';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Actor,
	type Collaboration,
} from './harness.js';

const TIMEOUT_MS = 600_000;

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

const git = async (cwd: string, args: string[]): Promise<void> => {
	const result = await execGit({args, cwd});
	if (isFail(result)) {
		throw new Error(`git ${args.join(' ')}\n${result.message}`);
	}
};

/**
 * Points every clone of this repository at a transport that pauses before
 * serving. `%s` is the service name git asks for (`upload-pack`,
 * `receive-pack`), so both directions go through the pause.
 */
const slowDownRemote = async (
	actor: Actor,
	remoteRoot: string,
	seconds: number,
): Promise<void> => {
	// A script rather than an inline `sh -c`: git's ext:: transport splits its
	// command on whitespace, so quoting does not survive the round trip.
	const script = path.join(actor.globalDir, 'slow-transport.sh');
	fs.writeFileSync(
		script,
		['#!/bin/sh', `sleep ${seconds}`, 'exec "git-$1" "$2"', ''].join('\n'),
		{mode: 0o755},
	);

	const url = `ext::${script} %s ${remoteRoot}`;

	// Off by default since git 2.x; this is test scaffolding, not a change to
	// how epiq talks to a remote.
	await git(actor.repoRoot, [
		'config',
		'--local',
		'protocol.ext.allow',
		'always',
	]);
	await git(actor.repoRoot, ['remote', 'set-url', 'origin', url]);

	// The state branch lives in its own worktree, but shares the clone's
	// config, so this is the same remote the sync will use.
};

describe('a remote that answers, slowly', () => {
	it(
		'tells the difference between a slow remote and no remote',
		async () => {
			const collab = await startCollaboration({names: ['ana', 'bo']});
			running = collab;

			const [ana, bo] = collab.actors as [Actor, Actor];

			expect(
				(await runActor(ana, {init: true, actions: [], sync: true})).problems,
				'ana creating the project',
			).toEqual([]);
			expect(
				(await runActor(bo, {actions: [], sync: true})).problems,
				'bo joining',
			).toEqual([]);

			// Something for ana to publish, and something for bo to be missing.
			await slowDownRemote(ana, collab.remoteRoot, 12);

			const report = await runActor(ana, {
				actions: [{kind: 'create', title: 'written-over-a-slow-link'}],
				sync: true,
			});

			// Whatever it does, it must not claim success and it must not lose the
			// issue locally.
			expect(
				report.issues.some(entry => entry.endsWith('written-over-a-slow-link')),
				'the issue is on ana’s own board',
			).toBe(true);

			// Bo is the proof: ana was told nothing was wrong, and the work is
			// still only on her machine.
			const received = await runActor(bo, {actions: [], sync: true});
			expect(received.problems, 'bo settling').toEqual([]);

			const reachedBo = received.issues.some(entry =>
				entry.endsWith('written-over-a-slow-link'),
			);

			expect(
				{reachedBo, problems: report.problems},
				'a reachable remote that is merely slow must still receive the work',
			).toEqual({reachedBo: true, problems: []});
		},
		TIMEOUT_MS,
	);
});
