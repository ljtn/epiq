import {describe, expect, it} from 'vitest';
import {actorDisplay, actorDisplayChars} from './agent-identity';

describe('actorDisplay', () => {
	it('drops an agent’s provider and keeps the slash', () => {
		expect(actorDisplay('claude/peter')).toEqual({
			label: '/peter',
			isAgent: true,
		});
		// Any provider, not a list of the ones we know.
		expect(actorDisplay('gemini/ann')).toEqual({
			label: '/ann',
			isAgent: true,
		});
	});

	it('leaves every other name as it is', () => {
		expect(actorDisplay('jola')).toEqual({label: 'jola', isAgent: false});
		expect(actorDisplay('Jonatan Lampa')).toEqual({
			label: 'Jonatan Lampa',
			isAgent: false,
		});
		// A prefix with nothing behind it, a name that is already bare, and a
		// path-like name are none of them `provider/name`.
		expect(actorDisplay('claude/')).toEqual({
			label: 'claude/',
			isAgent: false,
		});
		expect(actorDisplay('/peter')).toEqual({label: '/peter', isAgent: false});
		expect(actorDisplay('a/b/c')).toEqual({label: 'a/b/c', isAgent: false});
	});
});

describe('actorDisplayChars', () => {
	it('counts what is written, not the prefix', () => {
		expect(actorDisplayChars('claude/peter')).toBe('/peter'.length);
		expect(actorDisplayChars('jola')).toBe(4);
	});
});
