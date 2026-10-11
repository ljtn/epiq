import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {getCommitTimeline} from '../lib/commits/commit-timeline.js';
import {resolveSourceRef} from '../lib/commits/commit-repo.js';
import {SourceSpecSchema} from '../lib/commits/sources/source-spec.js';
import {isFail} from '../lib/model/result-types.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';

// A board that watches other repositories reads their history from epiq's
// own bare clones; the board's own repository is the source `self`, read in
// place. These tests hold the boundary between the two: what a project file
// may register, and how an id becomes a directory git can be pointed at —
// against real git and real files rather than mocks, because what is under
// test is the agreement with both.

let repo = '';
let clone = '';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, {cwd, stdio: 'pipe'}).toString();

const write = (name: string, contents: Buffer | string) =>
	fs.writeFileSync(path.join(repo, name), contents);

const writeProjectFile = (project: unknown) =>
	write('.epiq/project.json', JSON.stringify(project, null, 2) + '\n');

const baseProject = {
	projectId: '01M2XZW1424SQK471GQRM4X72P',
	stateBranch: '__epiq_state__',
	createdAt: new Date(0).toISOString(),
};

beforeEach(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sources-'));

	git(repo, 'init', '-q', '-b', 'main');
	git(repo, 'config', 'user.name', 'Test');
	git(repo, 'config', 'user.email', 'test@example.com');
	git(repo, 'config', 'commit.gpgsign', 'false');

	fs.mkdirSync(path.join(repo, '.epiq'));
	writeProjectFile(baseProject);

	write('readme.md', '# first\n');
	git(repo, 'add', '-A');
	git(repo, 'commit', '-q', '-m', 'first');

	// The state branch, as a root commit of its own: real boards keep it off
	// the development line, and `git log --not <stateBranch>` needs the ref to
	// resolve at all.
	const stateTree = git(repo, 'write-tree').trim();
	const stateCommit = git(repo, 'commit-tree', stateTree, '-m', 'state').trim();
	git(repo, 'update-ref', 'refs/heads/__epiq_state__', stateCommit);
});

afterEach(() => {
	fs.rmSync(repo, {recursive: true, force: true});
	if (clone !== '') {
		fs.rmSync(clone, {recursive: true, force: true});
		clone = '';
	}
});

describe('a registered source spec', () => {
	it('accepts a full spec', () => {
		const parsed = SourceSpecSchema.safeParse({
			id: 'widgets',
			url: 'https://example.com/widgets.git',
			branches: ['main', 'release'],
			since: '2025-06-22T22:50:09.000Z',
		});

		expect(parsed.success).toBe(true);
	});

	it('accepts a bare id and url', () => {
		const parsed = SourceSpecSchema.safeParse({
			id: 'widgets',
			url: 'ssh://git@example.com/widgets.git',
		});

		expect(parsed.success).toBe(true);
	});

	it('rejects the reserved id "self"', () => {
		const parsed = SourceSpecSchema.safeParse({
			id: 'self',
			url: 'https://example.com/widgets.git',
		});

		expect(parsed.success).toBe(false);
	});

	it('rejects ids that could leave .epiq/sources', () => {
		for (const id of [
			'../escape',
			'Widgets',
			'-dash-first',
			'a/b',
			'way-too-long-an-id-to-fit-the-thirty-two-characters',
		]) {
			expect(
				SourceSpecSchema.safeParse({id, url: 'https://example.com/w.git'})
					.success,
			).toBe(false);
		}
	});

	it('rejects a url git could not clone', () => {
		const parsed = SourceSpecSchema.safeParse({
			id: 'widgets',
			url: 'not a url',
		});

		expect(parsed.success).toBe(false);
	});
});

describe('project.json carrying sources', () => {
	it('parses without the field, as every existing project file reads', () => {
		const result = readProjectFile(repo);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.sources).toBeUndefined();
	});

	it('parses with registered sources', () => {
		writeProjectFile({
			...baseProject,
			sources: [{id: 'widgets', url: 'https://example.com/widgets.git'}],
		});

		const result = readProjectFile(repo);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.sources?.[0]?.id).toBe('widgets');
	});

	it('refuses a spec that could not have been meant', () => {
		writeProjectFile({
			...baseProject,
			sources: [{id: 'self', url: 'https://example.com/widgets.git'}],
		});

		const result = readProjectFile(repo);

		expect(isFail(result)).toBe(true);
	});
});

describe('resolving a source', () => {
	it('reads the board repository in place by default', () => {
		const result = resolveSourceRef({repoRoot: repo});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value).toEqual({
			id: 'self',
			kind: 'self',
			gitPath: repo,
			stateBranch: '__epiq_state__',
		});
	});

	it('resolves a registered source to its clone path, existing or not', () => {
		writeProjectFile({
			...baseProject,
			sources: [{id: 'widgets', url: 'https://example.com/widgets.git'}],
		});

		const result = resolveSourceRef({repoRoot: repo, sourceId: 'widgets'});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value).toEqual({
			id: 'widgets',
			kind: 'clone',
			gitPath: path.join(repo, '.epiq', 'sources', 'widgets.git'),
		});
		// The clone is not created by resolving it: fetching is a later phase,
		// and resolving must stay a pure read.
		expect(fs.existsSync(result.value.gitPath)).toBe(false);
	});

	it('names the registered sources when asked for one that is not', () => {
		writeProjectFile({
			...baseProject,
			sources: [
				{id: 'widgets', url: 'https://example.com/widgets.git'},
				{id: 'gadgets', url: 'https://example.com/gadgets.git'},
			],
		});

		const result = resolveSourceRef({repoRoot: repo, sourceId: 'nope'});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;

		expect(result.message).toContain('widgets');
		expect(result.message).toContain('gadgets');
	});
});

describe('reading a timeline through the same code path', () => {
	// The proof the refactor exists for: the board's own repository and a
	// bare clone answer through one `getCommitTimeline`, differing only in
	// where git runs and which source id the entries carry.
	beforeEach(() => {
		clone = path.join(repo, '.epiq', 'sources', 'mirror.git');
		fs.mkdirSync(path.dirname(clone), {recursive: true});
		// Single-branch, as the clone store of a later phase will create it:
		// a clone holds the branches the spec names and nothing else.
		git(
			repo,
			'clone',
			'-q',
			'--bare',
			'--single-branch',
			'-b',
			'main',
			repo,
			clone,
		);

		writeProjectFile({
			...baseProject,
			sources: [{id: 'mirror', url: 'https://example.com/mirror.git'}],
		});
	});

	it('reads the board repository as self', async () => {
		const result = await getCommitTimeline({repoRoot: repo});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value).toHaveLength(1);
		expect(result.value[0]?.sourceId).toBe('self');
	});

	it('reads a bare clone of a registered source', async () => {
		const result = await getCommitTimeline({
			repoRoot: repo,
			sourceId: 'mirror',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value).toHaveLength(1);
		expect(result.value[0]?.sourceId).toBe('mirror');
		expect(result.value[0]?.subject).toBe('first');
	});

	it('commits after the clone was made appear only after a fetch', async () => {
		write('readme.md', '# second\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', 'second');

		const selfResult = await getCommitTimeline({repoRoot: repo});
		const mirrorResult = await getCommitTimeline({
			repoRoot: repo,
			sourceId: 'mirror',
		});

		if (isFail(selfResult) || isFail(mirrorResult)) {
			throw new Error('timelines failed to read');
		}

		// A source is a snapshot at fetch time, by design: commits show up
		// once pushed and the board has synced.
		expect(selfResult.value).toHaveLength(2);
		expect(mirrorResult.value).toHaveLength(1);
	});
});
