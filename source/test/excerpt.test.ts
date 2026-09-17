import {describe, expect, it} from 'vitest';
import {plainExcerpt} from '../lib/utils/excerpt.js';

describe('plainExcerpt', () => {
	it('folds a multi-line description onto one line', () => {
		expect(plainExcerpt('First paragraph.\n\nSecond one.', 100)).toBe(
			'First paragraph. Second one.',
		);
	});

	it('drops a fenced block rather than shrinking it', () => {
		expect(
			plainExcerpt('Before\n\n```ts\nconst x = 1;\n```\n\nAfter', 100),
		).toBe('Before After');
	});

	it('drops an unterminated fence too', () => {
		expect(plainExcerpt('Before\n\n```\nstill open', 100)).toBe('Before');
	});

	it('keeps a link’s text and loses its target', () => {
		expect(
			plainExcerpt('See [the readme](https://example.com/x) first', 100),
		).toBe('See the readme first');
	});

	it('drops an image, alt text and all', () => {
		expect(plainExcerpt('Look: ![a screenshot](/media/a.png) there', 100)).toBe(
			'Look: there',
		);
	});

	it('strips headings, bullets and emphasis', () => {
		expect(
			plainExcerpt('## Plan\n\n- **do** this\n- `then` that\n1. and this', 100),
		).toBe('Plan do this then that and this');
	});

	it('drops a thematic break', () => {
		expect(plainExcerpt('Above\n\n---\n\nBelow', 100)).toBe('Above Below');
	});

	it('cuts on a word boundary and says it was cut', () => {
		expect(plainExcerpt('alpha beta gamma delta', 16)).toBe('alpha beta…');
	});

	it('cuts mid-word when the boundary is too far back', () => {
		expect(plainExcerpt('a supercalifragilistic word', 12)).toBe(
			'a supercali…',
		);
	});

	it('leaves a description that already fits untouched by the ellipsis', () => {
		expect(plainExcerpt('short', 5)).toBe('short');
	});

	it('is empty for an empty description', () => {
		expect(plainExcerpt('', 100)).toBe('');
	});

	it('is empty at a limit of zero', () => {
		expect(plainExcerpt('anything', 0)).toBe('');
	});
});
