import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {foldRepoEvents, resolveRepos} from '../lib/board/board-repos.js';
import {planRepoChange} from '../lib/commits/commit-repos.js';
import {
	isAllowedRepoUrl,
	localReposAllowed,
	repoUrlProblem,
} from '../lib/commits/repo-url.js';
import {isFail} from '../lib/model/result-types.js';

// A connected repo is fetched by every contributor, so a path on one machine
// is no repo for a board. The suites allow them to stay off the network.

const LOCAL = 'file:///srv/git/thing.git';
const REMOTE = 'https://example.com/team/thing.git';

let saved: string | undefined;

beforeEach(() => {
	saved = process.env['EPIQ_ALLOW_LOCAL_REPOS'];
	delete process.env['EPIQ_ALLOW_LOCAL_REPOS'];
});

afterEach(() => {
	if (saved === undefined) delete process.env['EPIQ_ALLOW_LOCAL_REPOS'];
	else process.env['EPIQ_ALLOW_LOCAL_REPOS'] = saved;
});

describe('a local repo', () => {
	it('is refused unless the process allows it', () => {
		expect(localReposAllowed()).toBe(false);
		expect(repoUrlProblem(LOCAL)).toBe(
			'is a path on this machine, which nobody else can fetch',
		);
		expect(isAllowedRepoUrl(REMOTE)).toBe(true);

		process.env['EPIQ_ALLOW_LOCAL_REPOS'] = '1';
		expect(isAllowedRepoUrl(LOCAL)).toBe(true);
		expect(repoUrlProblem(LOCAL, false)).not.toBeNull();
	});

	it('is never planned for a connect', () => {
		const plan = planRepoChange({repoRoot: '/nowhere', url: LOCAL});

		expect(isFail(plan) && plan.message).toContain('nobody else can fetch');
	});

	it('is kept by the fold but never listed, so no build disagrees on the log', () => {
		const registry = foldRepoEvents([
			{action: 'connect.repo', payload: {url: LOCAL}},
			{action: 'connect.repo', payload: {url: REMOTE}},
		]);

		expect(Object.keys(registry.entries)).toHaveLength(2);
		expect(resolveRepos(registry).live.map(repo => repo.url)).toEqual([REMOTE]);
	});
});
