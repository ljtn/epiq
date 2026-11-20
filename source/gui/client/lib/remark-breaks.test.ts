import {describe, expect, it} from 'vitest';
import {remarkBreaks} from './remark-breaks';
import type {MdastNode} from './remark-ticket-refs';

const run = (...children: MdastNode[]): MdastNode[] => {
	const tree: MdastNode = {
		type: 'root',
		children: [{type: 'paragraph', children}],
	};
	remarkBreaks()(tree);
	return tree.children![0]!.children!;
};

const text = (value: string): MdastNode => ({type: 'text', value});
const BREAK = {type: 'break'};

describe('remarkBreaks', () => {
	it.each(['\n', '\r\n', '\r'])('breaks the line at %j', newline => {
		expect(run(text(`a${newline}b`))).toEqual([text('a'), BREAK, text('b')]);
	});

	it('leaves no empty text around a break', () => {
		expect(run(text('\na\n\n'))).toEqual([BREAK, text('a'), BREAK, BREAK]);
	});

	it('breaks inside emphasis and links too', () => {
		const [strong] = run({type: 'strong', children: [text('a\nb')]});

		expect(strong!.children).toEqual([text('a'), BREAK, text('b')]);
	});

	it('leaves code alone', () => {
		const code = {type: 'inlineCode', value: 'a\nb'};

		expect(run(code)).toEqual([code]);
	});

	it('keeps a line without a newline as it was', () => {
		const line = text('plain');

		expect(run(line)[0]).toBe(line);
	});
});
