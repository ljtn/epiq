import {describe, expect, it} from 'vitest';
import {matchItems, Matchable} from './command-match';

const item = (id: string, title: string, keywords?: string[]): Matchable => ({
	id,
	title,
	...(keywords ? {keywords} : {}),
});

const items = [
	item('new', 'New ticket', ['create']),
	item('comment', 'Comment on ticket'),
	item('close', 'Close ticket', ['done']),
	item('sync', 'Sync with the remote', ['push', 'pull']),
];

const titles = (matches: {item: Matchable}[]) =>
	matches.map(match => match.item.title);

describe('matchItems', () => {
	it('keeps the declared order when nothing is typed', () => {
		expect(titles(matchItems(items, ''))).toEqual([
			'New ticket',
			'Comment on ticket',
			'Close ticket',
			'Sync with the remote',
		]);
	});

	// The palette's resting state: what you reached for last is what you are
	// most likely reaching for now.
	it('leads with the recent ones, most recent first', () => {
		expect(
			titles(matchItems(items, '', {recentIds: ['sync', 'close']})),
		).toEqual([
			'Sync with the remote',
			'Close ticket',
			'New ticket',
			'Comment on ticket',
		]);
	});

	it('ignores a recent id that is no longer a command', () => {
		expect(
			titles(matchItems(items, '', {recentIds: ['config', 'close']})),
		).toEqual([
			'Close ticket',
			'New ticket',
			'Comment on ticket',
			'Sync with the remote',
		]);
	});

	// Loose on purpose, the way a fuzzy palette is: `cmt` also runs through
	// "Syn(c) with the re(m)o(t)e". What matters is which one leads.
	it('matches a subsequence, not just a substring', () => {
		expect(titles(matchItems(items, 'cmt'))[0]).toBe('Comment on ticket');
	});

	it('reports where it hit, so the row can mark it', () => {
		const [match] = matchItems(items, 'new');

		expect(match?.hits).toEqual([0, 1, 2]);
	});

	it('prefers a prefix to a hit further in', () => {
		expect(titles(matchItems(items, 'c')).slice(0, 2)).toEqual([
			'Comment on ticket',
			'Close ticket',
		]);
	});

	// The TUI keyword is what somebody who learned the other surface will type.
	it('finds a command by a keyword the title never says', () => {
		expect(titles(matchItems(items, 'push'))).toEqual(['Sync with the remote']);
	});

	// A project can hold thousands of tickets and the list is a picker: every
	// row returned becomes a DOM node behind a window showing eight.
	describe('the cap', () => {
		const many = Array.from({length: 5_000}, (_, index) =>
			item(`t${index}`, `Ticket number ${index}`),
		);

		it('returns no more than the limit from a query that matches everything', () => {
			expect(matchItems(many, 'ticket', {limit: 10})).toHaveLength(10);
		});

		// The one wanted is last in the input, so a cap applied while scanning
		// would have thrown it away before ever reaching it.
		it('keeps the best of the whole set, not the first it scanned', () => {
			const capped = matchItems(many, 'ticket number 4999', {limit: 10});

			expect(capped[0]?.item.title).toBe('Ticket number 4999');
		});

		it('caps the resting list too, where nothing has been typed', () => {
			expect(matchItems(many, '', {limit: 10})).toHaveLength(10);
		});

		it('leaves the list whole when no cap is asked for', () => {
			expect(matchItems(items, '')).toHaveLength(items.length);
		});

		it('caps to what matched, not to the limit', () => {
			expect(matchItems(items, 'sync', {limit: 10}).length).toBeLessThan(10);
		});
	});

	it('drops what matches nowhere', () => {
		expect(matchItems(items, 'zzz')).toEqual([]);
	});

	// What keeps unavailable commands listed but last, rather than hidden.
	it('orders by rank before score', () => {
		const rank = (candidate: Matchable) => (candidate.id === 'comment' ? 1 : 0);
		const ranked = titles(matchItems(items, 'c', {rank}));

		// Its score would have led; its rank puts it last instead.
		expect(ranked[0]).toBe('Close ticket');
		expect(ranked.at(-1)).toBe('Comment on ticket');
	});
});
