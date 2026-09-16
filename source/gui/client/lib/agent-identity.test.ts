import {describe, expect, it} from 'vitest';
import {actorDisplay, actorDisplayChars, MARK_CHARS} from './agent-identity';

describe('actorDisplay', () => {
	it('turns a provider prefix into a mark and gives the name its capital', () => {
		expect(actorDisplay('claude/peter')).toEqual({
			label: 'Peter',
			provider: 'claude',
		});
		expect(actorDisplay('codex/fred')).toEqual({
			label: 'Fred',
			provider: 'codex',
		});
	});

	it('leaves every other name as it is', () => {
		expect(actorDisplay('jola')).toEqual({label: 'jola', provider: null});
		expect(actorDisplay('Jonatan Lampa')).toEqual({
			label: 'Jonatan Lampa',
			provider: null,
		});
		// A slash alone is not a provider, and an unknown one is just a name.
		expect(actorDisplay('gemini/ann')).toEqual({
			label: 'gemini/ann',
			provider: null,
		});
		expect(actorDisplay('claude/')).toEqual({label: 'claude/', provider: null});
		expect(actorDisplay('/peter')).toEqual({label: '/peter', provider: null});
	});
});

describe('actorDisplayChars', () => {
	it('counts the label and the mark, not the prefix', () => {
		expect(actorDisplayChars('claude/peter')).toBe('Peter'.length + MARK_CHARS);
		expect(actorDisplayChars('jola')).toBe(4);
	});
});
