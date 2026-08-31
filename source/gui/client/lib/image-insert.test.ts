import {describe, expect, it} from 'vitest';
import {imageFilesFrom, spliceImageMarkdown} from './image-insert';
import {
	getAttachmentMarkdown,
	getAttachmentUrl,
} from '../../../lib/media/attachment-url.js';

const md = getAttachmentMarkdown('shot.png', 'a'.repeat(64) + '.webp');

describe('spliceImageMarkdown', () => {
	it('drops the reference straight in when the body is empty', () => {
		expect(spliceImageMarkdown('', 0, md)).toEqual({
			value: md,
			caret: md.length,
		});
	});

	it('gives the image its own line when it lands mid-paragraph', () => {
		const {value} = spliceImageMarkdown('beforeafter', 6, md);

		expect(value).toBe(`before\n${md}\nafter`);
	});

	it('disturbs nothing else about the text it splits', () => {
		// The space is the tail's, and stays the tail's.
		expect(spliceImageMarkdown('before after', 6, md).value).toBe(
			`before\n${md}\n after`,
		);
	});

	it('adds no newline where one is already there', () => {
		const {value} = spliceImageMarkdown('before\n\nafter', 7, md);

		expect(value).toBe(`before\n${md}\nafter`);
	});

	it('leaves the caret after what it inserted, ready to keep typing', () => {
		const {value, caret} = spliceImageMarkdown('a', 1, md);

		expect(value.slice(0, caret)).toBe(`a\n${md}`);
	});

	// The upload is a round trip, so the body can have been typed into — or
	// cleared — by the time the reference arrives.
	it('clamps a caret that no longer fits the body', () => {
		expect(spliceImageMarkdown('ab', 999, md).value).toBe(`ab\n${md}`);
		expect(spliceImageMarkdown('ab', -5, md).value).toBe(`${md}\nab`);
	});
});

describe('imageFilesFrom', () => {
	const file = (type: string) => ({type} as File);

	it('keeps only images, whatever else was dropped', () => {
		expect(
			imageFilesFrom([
				file('image/png'),
				file('text/plain'),
				file('image/webp'),
			]),
		).toHaveLength(2);
	});

	it('shrugs off nothing at all', () => {
		expect(imageFilesFrom(null)).toEqual([]);
		expect(imageFilesFrom(undefined)).toEqual([]);
	});
});

// The client builds no URL of its own; it inserts what the server handed back.
// This pins the shape both sides agree on.
describe('the reference the server hands back', () => {
	it('points at the route that serves the blob', () => {
		expect(getAttachmentUrl('deadbeef.png')).toBe('/media/deadbeef.png');
		expect(getAttachmentMarkdown('a shot', 'deadbeef.png')).toBe(
			'![a shot](/media/deadbeef.png)',
		);
	});
});
