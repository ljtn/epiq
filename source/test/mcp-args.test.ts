import {describe, expect, it} from 'vitest';
import {parseMcpArgs} from '../mcp/args.js';
import {EPIQ_VERSION} from '../version.js';

describe('parseMcpArgs', () => {
	it('reads a bare argument as the name to write under', () => {
		expect(parseMcpArgs(['claude/peter'])).toEqual({
			kind: 'name',
			name: 'claude/peter',
		});
	});

	it('asks for nothing when there is no argument', () => {
		expect(parseMcpArgs([])).toEqual({kind: 'none'});
	});

	// The first write under a flag-shaped name registers a contributor the
	// board can never be rid of.
	it.each(['--version', '-v', '--help', '-h', '--unknown', '-x'])(
		'never takes %s as a name',
		flag => {
			expect(parseMcpArgs([flag]).kind).not.toBe('name');
		},
	);

	it('prints the version', () => {
		expect(parseMcpArgs(['--version'])).toEqual({
			kind: 'print',
			text: `${EPIQ_VERSION}\n`,
		});
	});

	it('prints help naming the argument', () => {
		const parsed = parseMcpArgs(['--help']);

		expect(parsed.kind).toBe('print');
		expect(parsed.kind === 'print' && parsed.text).toContain('claude/peter');
	});

	it('refuses an unknown option rather than guessing', () => {
		const parsed = parseMcpArgs(['--as']);

		expect(parsed.kind).toBe('error');
		expect(parsed.kind === 'error' && parsed.message).toContain('--as');
	});

	it('refuses more than one argument', () => {
		expect(parseMcpArgs(['a', 'b']).kind).toBe('error');
	});
});
