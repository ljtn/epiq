import {describe, expect, it} from 'vitest';
import {
	classifyLine,
	deriveCommentDensity,
} from '../lib/stats/comment-density.js';
import {commentSyntaxOf} from '../lib/stats/file-kinds.js';
import {deriveFlags} from '../lib/stats/flags.js';
import {parsePatchOutput} from '../lib/stats/patch-scan.js';

const REC = '\x1e';

const file = (path: string, added: string[], removed: string[] = []): string =>
	[
		`${REC}aaa`,
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -1,${removed.length} +1,${added.length} @@`,
		...removed.map(text => `-${text}`),
		...added.map(text => `+${text}`),
	].join('\n');

const patchOf = (stdout: string) => {
	const parsed = parsePatchOutput(stdout);

	return {
		files: parsed.files,
		insertions: parsed.insertions,
		deletions: parsed.deletions,
		selfChurn: parsed.selfChurn,
		scannedCommits: 1,
		truncated: false,
	};
};

describe('classifyLine', () => {
	const ts = commentSyntaxOf('app.ts');
	const py = commentSyntaxOf('app.py');

	it('reads a line comment, a block opener and its continuation as prose', () => {
		expect(classifyLine('// why', ts)).toBe('comment');
		expect(classifyLine('/**', ts)).toBe('comment');
		expect(classifyLine(' * more', ts)).toBe('comment');
		expect(classifyLine(' */', ts)).toBe('comment');
	});

	it('uses the language of the file, not one syntax for all of them', () => {
		expect(classifyLine('# why', py)).toBe('comment');
		expect(classifyLine('# why', ts)).toBe('code');
		expect(classifyLine('"""a docstring', py)).toBe('comment');
	});

	it('counts an unlisted language as code rather than guessing', () => {
		expect(classifyLine('// might not be a comment here', null)).toBe('code');
	});

	it('separates blank lines from both', () => {
		expect(classifyLine('   ', ts)).toBe('blank');
	});
});

describe('deriveCommentDensity', () => {
	it('shares are of non-blank lines, and carry the repo baseline beside them', () => {
		const density = deriveCommentDensity({
			patch: patchOf(
				file('source/app.ts', ['// one', 'const a = 1;', '', 'const b = 2;']),
			),
			repoShareByLanguage: new Map([['TypeScript', 0.11]]),
		});

		expect(density.commentLines).toBe(1);
		expect(density.codeLines).toBe(2);
		expect(density.blankLines).toBe(1);
		expect(density.share).toBeCloseTo(1 / 3);
		expect(density.byLanguage[0]?.repoShare).toBeCloseTo(0.11);
	});

	it('leaves the comparison empty when there is no baseline', () => {
		const density = deriveCommentDensity({
			patch: patchOf(file('source/app.ts', ['// one', 'const a = 1;'])),
			repoShareByLanguage: null,
		});

		expect(density.byLanguage[0]?.repoShare).toBeNull();
	});

	it('counts TODOs both arriving and leaving', () => {
		const density = deriveCommentDensity({
			patch: patchOf(
				file(
					'source/app.ts',
					['// TODO: later', 'const a = 1;'],
					['// FIXME: was broken'],
				),
			),
			repoShareByLanguage: null,
		});

		expect(density.todoLinesAdded).toBe(1);
		expect(density.todoLinesRemoved).toBe(1);
	});

	it('tells commented-out code from an explanation', () => {
		const density = deriveCommentDensity({
			patch: patchOf(
				file('source/app.ts', [
					'// const old = compute();',
					'// why this had to change',
				]),
			),
			repoShareByLanguage: null,
		});

		expect(density.commentLines).toBe(2);
		expect(density.commentedOutCodeLines).toBe(1);
	});
});

describe('deriveFlags', () => {
	it('names the generated, dependency and CI paths a change touched', () => {
		const flags = deriveFlags({
			patch: patchOf(
				[
					file('package-lock.json', ['"integrity": "sha512-..."']),
					file('package.json', ['"ws": "^8.21.0",']),
					file('.github/workflows/ci.yml', ['  - run: npm test']),
					file('readme.md', ['# hello']),
				].join('\n'),
			),
		});

		expect(flags.generatedPaths).toEqual(['package-lock.json']);
		expect(flags.dependencyManifests).toEqual(['package.json']);
		expect(flags.buildOrCiPaths).toEqual(['.github/workflows/ci.yml']);
		expect(flags.docsTouched).toBe(true);
	});

	it('counts debug prints across languages', () => {
		const flags = deriveFlags({
			patch: patchOf(
				[
					file('source/app.ts', ['console.log(value);', 'const a = 1;']),
					file('main.go', ['fmt.Println(value)']),
				].join('\n'),
			),
		});

		expect(flags.debugPrintLinesAdded).toBe(2);
	});

	it('measures nesting in the file own indentation unit', () => {
		const tabs = deriveFlags({
			patch: patchOf(
				file('source/app.ts', ['\tone', '\t\ttwo', '\t\t\tthree']),
			),
		});
		const spaces = deriveFlags({
			patch: patchOf(
				file('source/app.py', ['  one', '    two', '      three']),
			),
		});

		expect(tabs.maxIndentLevels).toBe(3);
		expect(spaces.maxIndentLevels).toBe(3);
	});

	it('finds a block copied from one file into another', () => {
		const block = [
			'const parsed = JSON.parse(raw);',
			'if (!parsed) return null;',
			'const items = parsed.items ?? [];',
			'const first = items[0];',
			'if (!first) return null;',
			'return first.value;',
		];

		const flags = deriveFlags({
			patch: patchOf(
				[file('source/a.ts', block), file('source/b.ts', block)].join('\n'),
			),
		});

		expect(flags.duplicatedLines).toBe(12);
	});

	it('does not call a block the ticket re-added to one file copy-paste', () => {
		const block = [
			'const parsed = JSON.parse(raw);',
			'if (!parsed) return null;',
			'const items = parsed.items ?? [];',
			'const first = items[0];',
			'if (!first) return null;',
			'return first.value;',
		];

		// The same path in two commits: a ticket that wrote a block, took it
		// out, and put it back. That is self-churn, not duplication.
		const flags = deriveFlags({
			patch: patchOf(
				[file('source/a.ts', block), file('source/a.ts', block)].join('\n'),
			),
		});

		expect(flags.duplicatedLines).toBe(0);
	});

	it('does not call a file moved to a new path copy-paste', () => {
		const block = [
			'const parsed = JSON.parse(raw);',
			'if (!parsed) return null;',
			'const items = parsed.items ?? [];',
			'const first = items[0];',
			'if (!first) return null;',
			'return first.value;',
		];

		// What a rename looks like under --no-renames: the same lines added at
		// the new path and the old path left deleted.
		const flags = deriveFlags({
			patch: patchOf(
				[
					file('source/new-name.ts', block),
					[
						`${REC}aaa`,
						'diff --git a/source/old-name.ts b/source/old-name.ts',
						'--- a/source/old-name.ts',
						'+++ /dev/null',
						`@@ -1,${block.length} +0,0 @@`,
						...block.map(text => `-${text}`),
					].join('\n'),
				].join('\n'),
			),
		});

		expect(flags.duplicatedLines).toBe(0);
	});

	it('does not call two unrelated files a duplicate of each other', () => {
		const flags = deriveFlags({
			patch: patchOf(
				[
					file('source/a.ts', ['const a = 1;', 'const b = 2;']),
					file('source/b.ts', ['const c = 3;', 'const d = 4;']),
				].join('\n'),
			),
		});

		expect(flags.duplicatedLines).toBe(0);
	});
});
