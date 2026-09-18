import {describe, expect, it, vi} from 'vitest';
import {parseCommandLine} from '../lib/command-line/command-parser.js';
import {getAutoCompletion} from '../lib/command-line/command-auto-complete.js';
import {autoCompletionFromWordList} from '../lib/command-line/command-auto-complete.utils.js';

vi.mock('../lib/command-line/command-meta.js', () => ({
	isCmdKeyword: (value: string) =>
		['delete', 'view', 'tag', 'assign', 'help', 'rename', 'new'].includes(
			value,
		),
}));

vi.mock('../lib/command-line/command-modifiers.js', () => ({
	getCmdModifiers: (command: string) => {
		switch (command) {
			case 'delete':
				return ['confirm'];
			case 'view':
				return ['dense', 'wide'];
			case 'tag':
				return ['critical', 'frontend', 'backend'];
			case 'assign':
				return ['john', 'jane'];
			case 'help':
				return [];
			case 'rename':
				return [];
			case 'new':
				return ['issue', 'swimlane', 'board'];
			default:
				return [];
		}
	},
}));

describe('getAutoCompletion (remainder)', () => {
	it('returns remainder for command completion ("ta" -> "tag")', () => {
		const parsed = parseCommandLine('ta');
		expect(getAutoCompletion(parsed, ['tag', 'assign', 'new']).remainder).toBe(
			'g ',
		);
	});

	it('returns remainder for modifier completion ("tag c" -> "critical")', () => {
		const parsed = parseCommandLine('tag c');
		expect(
			getAutoCompletion(parsed, ['critical', 'frontend', 'backend']).remainder,
		).toBe('ritical ');
	});

	it('returns remainder for command completion ("vi" -> "view")', () => {
		const parsed = parseCommandLine('vi');
		expect(getAutoCompletion(parsed, ['view', 'tag', 'assign']).remainder).toBe(
			'ew ',
		);
	});

	it('returns remainder for modifier completion ("view d" -> "dense")', () => {
		const parsed = parseCommandLine('view d');
		expect(getAutoCompletion(parsed, ['dense', 'wide']).remainder).toBe(
			'ense ',
		);
	});

	it('returns remainder for modifier completion ("view w" -> "wide")', () => {
		const parsed = parseCommandLine('view w');
		expect(getAutoCompletion(parsed, ['dense', 'wide']).remainder).toBe('ide ');
	});

	it('returns empty remainder when last word is completed ("new ")', () => {
		const parsed = parseCommandLine('new ');
		expect(
			getAutoCompletion(parsed, ['issue', 'swimlane', 'board']).remainder,
		).toBe('');
	});

	it('returns empty remainder when no matching completion exists ("tag critical crime")', () => {
		const parsed = parseCommandLine('tag critical crime');
		expect(
			getAutoCompletion(parsed, ['critical', 'frontend', 'backend']).remainder,
		).toBe(' ');
	});

	it('returns remainder for modifier completion ("new iss" -> "issue")', () => {
		const parsed = parseCommandLine('new iss');
		expect(
			getAutoCompletion(parsed, ['issue', 'swimlane', 'board']).remainder,
		).toBe('ue ');
	});

	it('returns remainder for word completion ("new issue fron" -> "frontend")', () => {
		const parsed = parseCommandLine('new issue fron');
		expect(
			getAutoCompletion(parsed, ['frontend', 'backend', 'critical']).remainder,
		).toBe('tend ');
	});

	it('is case-insensitive for completion ("new issue Fron" -> "frontend")', () => {
		const parsed = parseCommandLine('new issue Fron');
		expect(
			getAutoCompletion(parsed, ['frontend', 'backend', 'critical']).remainder,
		).toBe('tend ');
	});
});

describe('matching is case-insensitive', () => {
	// Every word list in the app happened to be lowercase until a person's git
	// name became one. The index keyed on the word's own case while the lookup
	// lowercased its input, so a capitalised word could never be matched.
	it('completes a capitalised word from a lowercase prefix', () => {
		expect(
			autoCompletionFromWordList({
				wordList: ['Jonatan Lampa'],
				inputToMatch: 'jon',
			}),
		).toEqual(['Jonatan Lampa']);
	});

	it('completes it from the same case too', () => {
		expect(
			autoCompletionFromWordList({
				wordList: ['Jonatan Lampa'],
				inputToMatch: 'Jon',
			}),
		).toEqual(['Jonatan Lampa']);
	});

	it('gives the word back as it is written, not lowercased', () => {
		const [match] = autoCompletionFromWordList({
			wordList: ['Jonatan Lampa'],
			inputToMatch: 'jonatan',
		});

		expect(match).toBe('Jonatan Lampa');
	});
});

describe('completing with nothing typed', () => {
	const parsed = (value: string) => parseCommandLine(value);

	// A first letter that could only ever be one letter is not a choice, it is
	// an obstacle: `:config username ` with one name on offer fills it.
	it('fills the one candidate when the argument is empty', () => {
		const completion = getAutoCompletion(
			parsed('view dense '),
			['Jonatan Lampa'],
			['Jonatan Lampa'],
		);

		expect(completion.remainder).toBe('Jonatan Lampa ');
	});

	it('leaves an ambiguous argument alone', () => {
		const completion = getAutoCompletion(
			parsed('tag critical '),
			['vim', 'nano'],
			['vim', 'nano'],
		);

		expect(completion.remainder).toBe('');
	});

	// Otherwise tab would append a second value to one already given.
	it('does not fill an argument that already has a value', () => {
		const completion = getAutoCompletion(
			parsed('view dense already '),
			['Jonatan Lampa'],
			['Jonatan Lampa'],
		);

		expect(completion.remainder).toBe('');
	});

	// The board's whole vocabulary is in the general list; filling from it would
	// drop an arbitrary ticket word into the line.
	it('ignores the general word list, however small the contextual one is', () => {
		const completion = getAutoCompletion(
			parsed('view dense '),
			['some-ticket-word'],
			[],
		);

		expect(completion.remainder).toBe('');
	});
});
