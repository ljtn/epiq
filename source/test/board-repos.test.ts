import {describe, expect, it} from 'vitest';
import {
	applyRepoEvent,
	FOLD_DEFAULT_BRANCHES,
	FOLD_DEFAULT_SINCE,
	foldRepoEvents,
	MAX_REPOS,
	repoIdOf,
	resolveRepos,
	type RepoRegistry,
} from '../lib/board/board-repos.js';
import {isFail} from '../lib/model/result-types.js';

type Action = 'connect.repo' | 'edit.repo' | 'disconnect.repo';
const ev = (action: Action, payload: unknown) => ({action, payload});

const A = 'https://example.com/team/a.git';
const B = 'https://example.com/team/b.git';
const idA = repoIdOf(A);

const fold = (...events: ReturnType<typeof ev>[]) => foldRepoEvents(events);
const live = (registry: RepoRegistry) => resolveRepos(registry).live;

describe('the repo id', () => {
	// Every event names a repo by it, so a change to normalizing breaks logs.
	it('is pinned across the spellings of one URL', () => {
		for (const url of [
			'https://github.com/Me/Repo.git',
			'https://github.com/me/repo',
			'https://github.com/me/repo/',
			'HTTPS://GITHUB.COM/me/repo.git',
		]) {
			expect(repoIdOf(url)).toBe('repo-1479a649e7c7');
		}

		expect(repoIdOf('git@github.com:me/repo.git')).toBe('repo-659115ab0b5d');
		expect(repoIdOf('ssh://git@github.com/me/repo.git')).toBe(
			'repo-2471c14b301d',
		);
		expect(repoIdOf('file:///srv/git/thing.git')).toBe('thing-eff105fb7081');
	});

	it('keeps the defaults a connect leaves out, which are part of the format', () => {
		expect(FOLD_DEFAULT_BRANCHES).toBe('default');
		expect(FOLD_DEFAULT_SINCE).toBe('board');
	});
});

describe('applying repo events', () => {
	it('connects a new repo with the defaults for what it leaves out', () => {
		expect(live(fold(ev('connect.repo', {url: A})))).toEqual([
			{id: idA, url: A, branches: 'default', since: 'board', label: 'a'},
		]);
	});

	it('merges a connect of a live repo, keeping what it leaves out', () => {
		// A connect with no options racing an edit to since=all must not narrow it.
		const registry = fold(
			ev('connect.repo', {url: A}),
			ev('edit.repo', {repo: idA, since: 'all'}),
			ev('connect.repo', {url: A, label: 'alpha'}),
		);

		expect(live(registry)[0]).toMatchObject({since: 'all', label: 'alpha'});
	});

	it('keeps the first spelling of a live repo, and a revived one takes its own', () => {
		const other = 'https://EXAMPLE.com/team/a/';
		expect(repoIdOf(other)).toBe(idA);

		const merged = fold(
			ev('connect.repo', {url: A}),
			ev('connect.repo', {url: other}),
		);
		expect(live(merged)[0]?.url).toBe(A);

		const revived = fold(
			ev('connect.repo', {url: A}),
			ev('disconnect.repo', {repo: idA}),
			ev('connect.repo', {url: other}),
		);
		expect(live(revived)[0]?.url).toBe(other);
	});

	it('revives a disconnected repo as the connect says, not as it was left', () => {
		const registry = fold(
			ev('connect.repo', {url: A, since: 'all', label: 'alpha'}),
			ev('disconnect.repo', {repo: idA}),
			ev('connect.repo', {url: A}),
		);

		expect(live(registry)[0]).toMatchObject({since: 'board', label: 'a'});
	});

	it('skips an edit or a disconnect of a repo that is not live', () => {
		const gone = fold(
			ev('connect.repo', {url: A}),
			ev('disconnect.repo', {repo: idA}),
		);

		const edit = applyRepoEvent(
			gone,
			ev('edit.repo', {repo: idA, since: 'all'}),
		);
		const again = applyRepoEvent(gone, ev('disconnect.repo', {repo: idA}));
		const never = applyRepoEvent({}, ev('edit.repo', {repo: 'x-000000000000'}));

		expect([edit, again, never].every(isFail)).toBe(true);
		expect(live(gone)).toEqual([]);
	});

	it('drops a field it cannot read and keeps the rest', () => {
		const registry = fold(
			ev('connect.repo', {
				url: A,
				branches: 'some',
				since: 'yesterday',
				label: 'Bad Label',
			}),
			ev('edit.repo', {repo: idA, branches: 'all', since: '2025-02-30'}),
		);

		expect(live(registry)[0]).toMatchObject({
			branches: 'all',
			since: 'board',
			label: 'a',
		});
	});

	it('skips an edit with nothing it can read', () => {
		const registry = fold(ev('connect.repo', {url: A}));
		expect(
			isFail(
				applyRepoEvent(registry, ev('edit.repo', {repo: idA, since: 'soon'})),
			),
		).toBe(true);
	});

	it('clears a label with an empty one', () => {
		const registry = fold(
			ev('connect.repo', {url: A, label: 'alpha'}),
			ev('edit.repo', {repo: idA, label: ''}),
		);

		expect(live(registry)[0]?.label).toBe('a');
	});

	it('never lets in a URL git could be tricked by, and never throws on a payload', () => {
		for (const payload of [
			{url: 'ext::sh -c touch% /tmp/pwned'},
			{url: '--upload-pack=touch /tmp/pwned'},
			{url: 'https://user:secret@example.com/a.git'},
			{url: 'x'.repeat(5000)},
			{url: 42},
			null,
			'https://example.com/a.git',
			[],
		]) {
			expect(isFail(applyRepoEvent({}, ev('connect.repo', payload)))).toBe(
				true,
			);
		}

		expect(
			isFail(applyRepoEvent({}, ev('edit.repo', {repo: '__proto__'}))),
		).toBe(true);
	});
});

describe('resolving the list readers see', () => {
	const urls = Array.from(
		{length: MAX_REPOS + 3},
		(_, index) => `https://example.com/r${index}.git`,
	);

	it('reads the first repos to become live, and lists the rest as past the cap', () => {
		const resolved = resolveRepos(
			fold(...urls.map(url => ev('connect.repo', {url}))),
		);

		expect(resolved.live.map(repo => repo.url)).toEqual(
			urls.slice(0, MAX_REPOS),
		);
		expect(resolved.overLimit.map(repo => repo.url)).toEqual(
			urls.slice(MAX_REPOS),
		);
	});

	it('lets one past the cap in once one ahead of it goes', () => {
		const resolved = resolveRepos(
			fold(
				...urls.map(url => ev('connect.repo', {url})),
				ev('disconnect.repo', {repo: repoIdOf(urls[0]!)}),
			),
		);

		expect(resolved.live).toHaveLength(MAX_REPOS);
		expect(resolved.live.at(-1)?.url).toBe(urls[MAX_REPOS]);
		expect(resolved.disconnected).toEqual([repoIdOf(urls[0]!)]);
	});

	it('gives a contested label to the earliest, and back to a later one once it goes', () => {
		const contested = fold(
			ev('connect.repo', {url: A, label: 'api'}),
			ev('connect.repo', {url: B, label: 'api'}),
		);
		expect(live(contested).map(repo => repo.label)).toEqual(['api', 'b']);

		const freed = fold(
			ev('connect.repo', {url: A, label: 'api'}),
			ev('connect.repo', {url: B, label: 'api'}),
			ev('disconnect.repo', {repo: idA}),
		);
		expect(live(freed).map(repo => repo.label)).toEqual(['api']);
	});

	it('puts a reconnected repo last, as the one most recently live', () => {
		const registry = fold(
			ev('connect.repo', {url: A}),
			ev('connect.repo', {url: B}),
			ev('disconnect.repo', {repo: idA}),
			ev('connect.repo', {url: A}),
		);

		expect(live(registry).map(repo => repo.url)).toEqual([B, A]);
	});

	it('ignores everything but repo events in a log', () => {
		expect(
			foldRepoEvents([
				{action: 'add.issue', payload: {url: A}},
				{action: 'connect.repo', payload: {url: A}},
			]),
		).toEqual(fold(ev('connect.repo', {url: A})));
	});
});
