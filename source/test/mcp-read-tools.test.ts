import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	assumeActor,
	getAttachmentBlob,
	linkContributorEmail,
	listContributorEmails,
	suggestOwnEmails,
} from '../mcp/epiq-api.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

// Three read tools nothing exercised. They share the prologue every other tool
// runs — boot the project without touching the network, then read — so what is
// pinned here is that each answers from a real repository at all, which is what
// a change to that shared prologue would take away.

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const seedBoard = async () => {
	const {repoRoot} = await setupRepo();

	const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
	const branchRoot = unwrap(getStateBranchRoot({repoRoot}));
	const defaults = unwrap(createDefaultEvents(assumed));
	unwrap(materializeAndPersistAll([...defaults] as AppEvent[], branchRoot));

	return {repoRoot, actor: assumed};
};

describe('listContributorEmails', () => {
	it('answers with nothing claimed on a fresh board', async () => {
		const {repoRoot} = await seedBoard();

		const listed = unwrap(await listContributorEmails({repoRoot}));

		expect(listed.emails).toEqual([]);
		expect(listed.mine).toEqual([]);
	});

	it('lists an address once it is claimed, and whose it is', async () => {
		const {repoRoot} = await seedBoard();

		unwrap(await linkContributorEmail({repoRoot, email: 'peter@example.com'}));

		const listed = unwrap(await listContributorEmails({repoRoot}));

		expect(listed.emails.map(entry => entry.email)).toEqual([
			'peter@example.com',
		]);
		expect(listed.emails[0]?.contested).toBe(false);
		expect(listed.mine).toEqual(['peter@example.com']);
	});
});

describe('suggestOwnEmails', () => {
	// The seeded repository's own commits are the state branch's, which the scan
	// excludes on purpose — the board writing its own log is not work somebody
	// did. So a fresh board offers nothing, and says so rather than failing.
	it('answers from a repository with no history of its own', async () => {
		const {repoRoot} = await seedBoard();

		const suggested = unwrap(await suggestOwnEmails({repoRoot}));

		expect(Array.isArray(suggested.candidates)).toBe(true);
		expect(suggested.likely).toBe(
			suggested.candidates.filter(candidate => candidate.looksLikeYours).length,
		);
	});
});

describe('getAttachmentBlob', () => {
	it('refuses a file the store does not hold', async () => {
		const {repoRoot} = await seedBoard();

		const blob = await getAttachmentBlob({
			repoRoot,
			fileName: 'nothing-here.png',
		});

		expect(isFail(blob)).toBe(true);
	});
});
