import {describe, expect, it} from 'vitest';
import {remarkTicketRefs, TICKET_REF_URL_PREFIX} from './remark-ticket-refs';

type Node = {
	type: string;
	value?: string;
	url?: string;
	children?: Node[];
};

const KNOWN = new Set(['QDNP1JS', '2Q1QAPB']);
const isKnownRef = (ref: string) => KNOWN.has(ref);

const run = (tree: Node): Node => {
	remarkTicketRefs(isKnownRef)()(tree);
	return tree;
};

const paragraph = (...children: Node[]): Node => ({
	type: 'root',
	children: [{type: 'paragraph', children}],
});

const text = (value: string): Node => ({type: 'text', value});

const childrenOfParagraph = (tree: Node) => tree.children![0].children!;

describe('remarkTicketRefs', () => {
	it('splits a known ref out of surrounding prose into a link', () => {
		const result = run(paragraph(text('Filed QDNP1JS from a selection.')));

		expect(childrenOfParagraph(result)).toEqual([
			{type: 'text', value: 'Filed '},
			{
				type: 'link',
				url: `${TICKET_REF_URL_PREFIX}QDNP1JS`,
				children: [{type: 'text', value: 'QDNP1JS'}],
			},
			{type: 'text', value: ' from a selection.'},
		]);
	});

	it('links several refs in one run of text', () => {
		const result = run(paragraph(text('QDNP1JS and 2Q1QAPB')));

		expect(
			childrenOfParagraph(result).filter(node => node.type === 'link'),
		).toHaveLength(2);
	});

	it('wraps a ref written as inline code, keeping the code styling', () => {
		const result = run(paragraph({type: 'inlineCode', value: 'QDNP1JS'}));

		expect(childrenOfParagraph(result)).toEqual([
			{
				type: 'link',
				url: `${TICKET_REF_URL_PREFIX}QDNP1JS`,
				children: [{type: 'inlineCode', value: 'QDNP1JS'}],
			},
		]);
	});

	// The whole point of resolving against real tickets: these all match a
	// ref's 7-character Crockford-base32 shape but are not refs.
	it('leaves ref-shaped text that resolves to no ticket alone', () => {
		const result = run(paragraph(text('SEGMENT and ABCDEFG stay put')));

		expect(childrenOfParagraph(result)).toEqual([
			{type: 'text', value: 'SEGMENT and ABCDEFG stay put'},
		]);
	});

	it('leaves an unknown inline-code value alone', () => {
		const result = run(paragraph({type: 'inlineCode', value: 'db1f94d4'}));

		expect(childrenOfParagraph(result)).toEqual([
			{type: 'inlineCode', value: 'db1f94d4'},
		]);
	});

	it('does not match a ref embedded in a longer word', () => {
		const result = run(paragraph(text('XQDNP1JSX')));

		expect(childrenOfParagraph(result)).toEqual([
			{type: 'text', value: 'XQDNP1JSX'},
		]);
	});

	it('never rewrites inside an existing link', () => {
		const link: Node = {
			type: 'link',
			url: 'https://example.com',
			children: [text('QDNP1JS')],
		};
		const result = run(paragraph(link));

		expect(childrenOfParagraph(result)).toEqual([link]);
	});

	it('reaches refs nested inside emphasis and list items', () => {
		const tree: Node = {
			type: 'root',
			children: [
				{
					type: 'list',
					children: [
						{
							type: 'listItem',
							children: [{type: 'emphasis', children: [text('see QDNP1JS')]}],
						},
					],
				},
			],
		};

		const emphasis = run(tree).children![0].children![0].children![0];

		expect(emphasis.children).toEqual([
			{type: 'text', value: 'see '},
			{
				type: 'link',
				url: `${TICKET_REF_URL_PREFIX}QDNP1JS`,
				children: [{type: 'text', value: 'QDNP1JS'}],
			},
		]);
	});

	it('leaves a fenced code block untouched', () => {
		const tree: Node = {
			type: 'root',
			children: [{type: 'code', value: 'const a = QDNP1JS;'}],
		};

		expect(run(tree).children).toEqual([
			{type: 'code', value: 'const a = QDNP1JS;'},
		]);
	});
});
