import {describe, expect, it} from 'vitest';
import {parseCliArgs} from '../lib/command-line/cli-args.js';

describe('parseCliArgs', () => {
	it('boots the TUI with no arguments', () => {
		expect(parseCliArgs([])).toEqual({
			kind: 'run',
			command: undefined,
			as: undefined,
			open: true,
		});
	});

	it.each(['gui', 'setup', 'init'])('reads the %s command', command => {
		expect(parseCliArgs([command])).toMatchObject({kind: 'run', command});
	});

	it('takes --as with a separate or inline value', () => {
		expect(parseCliArgs(['--as', 'claude'])).toMatchObject({as: 'claude'});
		expect(parseCliArgs(['gui', '--as=claude'])).toMatchObject({
			command: 'gui',
			as: 'claude',
		});
	});

	it('opens no browser under --no-open', () => {
		expect(parseCliArgs(['gui', '--no-open'])).toMatchObject({open: false});
	});

	it.each([
		[['--help'], 'help'],
		[['-h'], 'help'],
		[['--version'], 'version'],
		[['-v'], 'version'],
	])('%j prints %s', (args, kind) => {
		expect(parseCliArgs(args).kind).toBe(kind);
	});

	it.each([
		[['nope'], 'Unknown command: nope'],
		[['init', 'foo'], 'Unexpected argument: foo'],
		[['--bogus'], '--bogus'],
		[['--as'], '--as'],
	])('refuses %j', (args, message) => {
		const parsed = parseCliArgs(args);

		expect(parsed.kind).toBe('error');
		expect(parsed.kind === 'error' && parsed.message).toContain(message);
	});
});
