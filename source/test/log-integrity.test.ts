import fs from 'node:fs';
import path from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {stageStateBranchOwnEventFile} from '../git/git.js';
import {assertLogOnlyGrew, findDroppedLines} from '../git/log-integrity.js';
import {isFail} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

const EVENT_FILE = '01ksayra4ghekjp888wfbwbrdd.jola.jsonl';
const RELATIVE = `.epiq/events/${EVENT_FILE}`;

const line = (n: number) =>
	JSON.stringify({
		v: 1,
		id: [`01H${String(n).padStart(23, '0')}`, null],
		'lock.node': {id: 'x'},
	});

describe('findDroppedLines', () => {
	it('sees nothing wrong in a pure append', () => {
		expect(findDroppedLines('a\nb\n', 'a\nb\nc\n')).toEqual([]);
	});

	it('ignores blank lines and a missing trailing newline', () => {
		expect(findDroppedLines('a\nb\n', 'a\n\nb')).toEqual([]);
	});

	// Order is not load-bearing; the loader derives it from refId.
	it('does not mind reordering, only loss', () => {
		expect(findDroppedLines('a\nb\n', 'b\na\n')).toEqual([]);
	});

	it('reports a dropped line', () => {
		expect(findDroppedLines('a\nb\nc\n', 'a\nc\n')).toEqual(['b']);
	});

	// The shape of the incident: 2158 lines replaced by one new one.
	it('reports a wholesale truncation', () => {
		const committed = ['a', 'b', 'c', 'd'].join('\n') + '\n';

		expect(findDroppedLines(committed, 'fresh\n')).toEqual([
			'a',
			'b',
			'c',
			'd',
		]);
	});
});

describe('the sync path refuses a truncated log', () => {
	let root: string;

	const write = (lines: string[]) =>
		fs.writeFileSync(path.join(root, RELATIVE), lines.join('\n') + '\n');

	beforeEach(async () => {
		root = makeTempDir();
		fs.mkdirSync(path.join(root, '.epiq', 'events'), {recursive: true});

		await execGit({args: ['init', '-q', '-b', 'main', '.'], cwd: root});
		await execGit({args: ['config', 'user.name', 'Test'], cwd: root});
		await execGit({args: ['config', 'user.email', 't@test'], cwd: root});

		write([line(1), line(2), line(3)]);
		await execGit({args: ['add', '-A'], cwd: root});
		await execGit({args: ['commit', '-qm', 'seed', '--no-verify'], cwd: root});
	});

	it('stages an appended log', async () => {
		write([line(1), line(2), line(3), line(4)]);

		const result = await stageStateBranchOwnEventFile({
			stateBranchRoot: root,
			eventFileName: EVENT_FILE,
		});

		expect(isFail(result)).toBe(false);
	});

	it('refuses a log that lost a line, and stages nothing', async () => {
		write([line(1), line(3)]);

		const result = await stageStateBranchOwnEventFile({
			stateBranchRoot: root,
			eventFileName: EVENT_FILE,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('missing 1');
		expect(result.message).toContain(RELATIVE);

		// Nothing reached the index, so an autosync has nothing to push.
		const staged = await execGit({
			args: ['diff', '--cached', '--name-only'],
			cwd: root,
		});
		if (isFail(staged)) throw new Error(staged.message);
		expect(staged.value.stdout.trim()).toBe('');
	});

	// What actually happened: the whole log replaced by one fresh bootstrap
	// event, committed by autosync, pushed, and pulled by everybody.
	it('refuses a wholesale truncation', async () => {
		write([line(99)]);

		const result = await stageStateBranchOwnEventFile({
			stateBranchRoot: root,
			eventFileName: EVENT_FILE,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('missing 3 of the 3');
	});

	it('allows a first sync, where nothing is committed yet', async () => {
		const fresh = makeTempDir();
		fs.mkdirSync(path.join(fresh, '.epiq', 'events'), {recursive: true});
		await execGit({args: ['init', '-q', '-b', 'main', '.'], cwd: fresh});
		fs.writeFileSync(path.join(fresh, RELATIVE), line(1) + '\n');

		const result = await assertLogOnlyGrew({
			stateBranchRoot: fresh,
			relativePath: RELATIVE,
			workingContent: line(1) + '\n',
		});

		expect(isFail(result)).toBe(false);
	});
});
