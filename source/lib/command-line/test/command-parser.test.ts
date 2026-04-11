import {describe, expect, it, vi} from 'vitest';
import {parseCommandLine} from '../command-parser.js';
import {CmdKeywords} from '../command-types.js';
vi.mock('../command-modifiers.js', () => ({
	getCmdModifiers: () => ({
		[CmdKeywords.DELETE]: ['confirm'],
		[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
		[CmdKeywords.TAG]: ['critical', 'frontend', 'backend'],
		[CmdKeywords.ASSIGN]: ['john', 'jane'],
		[CmdKeywords.HELP]: [],
		[CmdKeywords.RENAME]: [],
		[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
	}),
}));

describe('parseCommandLine target', () => {
	it('targets command for an empty string', () => {
		expect(parseCommandLine('').target).toBe('command');
	});

	it('targets command for whitespace only', () => {
		expect(parseCommandLine('   ').target).toBe('command');
	});

	it('targets command for a partial first word', () => {
		expect(parseCommandLine('ne').target).toBe('command');
	});

	it('targets command for a full first word that is not a command', () => {
		expect(parseCommandLine('hello').target).toBe('command');
	});

	it('targets command when the input has leading whitespace before a partial command', () => {
		expect(parseCommandLine('   ne').target).toBe('command');
	});

	it('targets modifier for a partial second word', () => {
		expect(parseCommandLine('new is').target).toBe('modifier');
	});

	it('targets modifier when the command is complete and followed by a space', () => {
		expect(parseCommandLine('new ').target).toBe('modifier');
	});

	it('targets modifier for a full valid modifier with no trailing input', () => {
		expect(parseCommandLine('new issue').target).toBe('modifier');
	});

	it('targets word for a full valid modifier with trailing input', () => {
		expect(parseCommandLine('new issue ').target).toBe('word');
	});

	it('targets word once command and modifier are present', () => {
		expect(parseCommandLine('new issue My new issu').target).toBe('word');
	});

	it('targets word when command and modifier are followed by a trailing space', () => {
		expect(parseCommandLine('new issue ').target).toBe('word');
	});

	it('targets word when command and modifier are followed by multiple spaces and text', () => {
		expect(parseCommandLine('new   issue   My new issu').target).toBe('word');
	});

	it('targets word when the third token has only started', () => {
		expect(parseCommandLine('new issue M').target).toBe('word');
	});

	it('targets modifier when the second token is invalid but still being typed', () => {
		expect(parseCommandLine('new x').target).toBe('modifier');
	});

	it('targets modifier when the second token is invalid and complete', () => {
		expect(parseCommandLine('new xyz').target).toBe('modifier');
	});

	it('targets word when there are three words even if the second token is not a valid modifier', () => {
		expect(parseCommandLine('new xyz something').target).toBe('word');
	});

	it('targets modifier with leading whitespace before command and partial modifier', () => {
		expect(parseCommandLine('   new is').target).toBe('modifier');
	});

	it('targets word with leading whitespace before command, modifier, and input', () => {
		expect(parseCommandLine('   new issue My new issu').target).toBe('word');
	});
});
