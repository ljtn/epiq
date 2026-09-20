import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Every MCP tool answers out of local state. A boot that pulled would put a
// network round trip — and another clone's writes — inside a call the caller
// believes is a read of their own repo, and would do it on a tool that never
// said it syncs. Syncing is `epiq_sync`'s job, and the autosync loop's, both of
// which announce themselves.
//
// Scanned rather than exercised: the rule is that *no* call site reaches the
// network, and a test per tool proves nothing about the one added next week.
// `bootLocal` is the one door, so the rule is one line to check and one line to
// break — rather than the thirty-seven copies of `{pull: false}` this replaced,
// each of which had to keep saying it.

// The whole tree, not just `mcp/api`: `boot` is exported, so a call from the
// server, the GUI's own layer or anywhere else would defeat the rule while a
// scan of one directory reported it kept.
const sourceDir = path.join(import.meta.dirname, '..');
const apiDir = path.join(sourceDir, 'mcp', 'api');

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
		const full = path.join(dir, entry.name);

		if (entry.isDirectory()) return sourceFiles(full);

		return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
			? [full]
			: [];
	});

// `boot(` and not `bootLocal(` or `bootedWithActorAndState(`, which are the door and
// the prologue built on it.
const linesMatching = (pattern: RegExp): {file: string; line: string}[] =>
	sourceFiles(sourceDir).flatMap(file =>
		readFileSync(file, 'utf8')
			.split('\n')
			// Prose mentions `boot()` too; a scan that counted those would report a
			// breach every time somebody explained the rule.
			.map(line => line.replace(/\/\/.*$/, ''))
			.filter(line => !line.trim().startsWith('*'))
			.filter(line => pattern.test(line))
			.map(line => ({file: path.basename(file), line: line.trim()})),
	);

const directBootCalls = () => linesMatching(/\bboot\(/);

describe('the MCP never pulls on boot', () => {
	// A vacuous pass is the failure mode of a scan: a rename, a moved folder or
	// a tightened filter would leave nothing to check and report success. The
	// door being used everywhere is what makes checking the door worth anything.
	it('boots through the one door, everywhere', () => {
		expect(linesMatching(/\bbootLocal\(/).length).toBeGreaterThan(4);
		expect(linesMatching(/\bbootedWithActorAndState\(/).length).toBeGreaterThan(
			15,
		);
	});

	// Named rather than counted, so a failure says which file went around it.
	it('reaches boot itself from that door alone', () => {
		expect(
			directBootCalls()
				.filter(({file}) => file !== 'boot.ts')
				.map(({file, line}) => `${file}: ${line}`),
		).toEqual([]);

		expect(directBootCalls()).toHaveLength(1);
	});

	it('and the door does not pull', () => {
		const door = readFileSync(path.join(apiDir, 'boot.ts'), 'utf8');
		const call = door.slice(door.indexOf('export const bootLocal'));

		expect(call.slice(0, call.indexOf(';'))).toContain('pull: false');
	});
});
