import {describe, expect, it, vi} from 'vitest';
import {getAutoCompletion} from '../command-auto-complete.js';
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

describe('getAutoCompletion (remainder)', () => {
	it('returns remainder for command completion ("ta" → "tag")', () => {
		const parsed = parseCommandLine('ta');
		expect(getAutoCompletion(parsed).remainder).toBe('g ');
	});

	it('returns remainder for modifier completion ("tag c" → "critical")', () => {
		const parsed = parseCommandLine('tag c');
		expect(getAutoCompletion(parsed).remainder).toBe('ritical ');
	});

	it('returns remainder for command completion ("set:vi" → "set:view")', () => {
		const parsed = parseCommandLine('set:vi');
		expect(getAutoCompletion(parsed).remainder).toBe('ew ');
	});

	it('returns remainder for modifier completion ("set:view d" → "dense")', () => {
		const parsed = parseCommandLine('set:view d');
		expect(getAutoCompletion(parsed).remainder).toBe('ense ');
	});

	it('returns remainder for modifier completion ("set:view w" → "wide")', () => {
		const parsed = parseCommandLine('set:view w');
		expect(getAutoCompletion(parsed).remainder).toBe('ide ');
	});

	it('returns empty remainder when no completion is available ("new ")', () => {
		const parsed = parseCommandLine('new ');
		expect(getAutoCompletion(parsed).remainder).toBe('');
	});

	it('returns empty remainder when no matching completion exists ("tag critical crime")', () => {
		const parsed = parseCommandLine('tag critical crime');
		expect(getAutoCompletion(parsed).remainder).toBe('');
	});

	it('returns remainder for word completion ("new iss" → "ue")', () => {
		const parsed = parseCommandLine('new iss');
		expect(getAutoCompletion(parsed).remainder).toBe('ue ');
	});

	it('returns remainder for word completion ("new issue fron" → "frontend")', () => {
		const parsed = parseCommandLine('new issue fron');
		expect(getAutoCompletion(parsed).remainder).toBe('tend ');
	});

	it('is case-insensitive for completion ("new issue Fron" → "frontend")', () => {
		const parsed = parseCommandLine('new issue Fron');
		expect(getAutoCompletion(parsed).remainder).toBe('tend ');
	});
});
