import {describe, expect, it} from 'vitest';
import {compactReply} from '../compact-reply.js';

describe('compactReply', () => {
	it('leaves out colours, false flags, nulls and empty lists inside a reply', () => {
		expect(
			compactReply({
				id: 'A',
				color: '#fff',
				isClosed: false,
				readonly: true,
				goal: null,
				tags: [],
				assignees: [{id: 'B', name: 'jola', color: '#000', isSelf: false}],
			}),
		).toEqual({id: 'A', readonly: true, assignees: [{id: 'B', name: 'jola'}]});
	});

	it('keeps zeros, empty strings and the value itself, even when empty', () => {
		expect(compactReply({done: 0, title: ''})).toEqual({done: 0, title: ''});
		expect(compactReply([])).toEqual([]);
		expect(compactReply(false)).toBe(false);
	});

	it('rounds floats and leaves integers alone', () => {
		expect(
			compactReply({
				share: 0.7261146496815286,
				small: 0.004123,
				ratio: 12.3456,
				createdAt: 1795213757295,
			}),
		).toEqual({
			share: 0.73,
			small: 0.0041,
			ratio: 12.35,
			createdAt: 1795213757295,
		});
	});
});
