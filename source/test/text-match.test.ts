import {describe, expect, it} from 'vitest';
import {issueMatchesText, textIncludes} from '../lib/utils/text-match.js';

const issue = {id: '01KS22YK9AXCMATZXTR5JZCS5M', title: 'Fix the Login bug'};

describe('textIncludes', () => {
	it('ignores case and surrounding whitespace', () => {
		expect(textIncludes('Fix the Login bug', '  login ')).toBe(true);
		expect(textIncludes('Fix the Login bug', 'logout')).toBe(false);
	});
});

describe('issueMatchesText', () => {
	it('matches everything on an empty or blank query', () => {
		expect(issueMatchesText(issue, '')).toBe(true);
		expect(issueMatchesText(issue, '   ')).toBe(true);
	});

	it('matches the title case-insensitively', () => {
		expect(issueMatchesText(issue, 'login')).toBe(true);
		expect(issueMatchesText(issue, 'LOGIN BUG')).toBe(true);
		expect(issueMatchesText(issue, 'signup')).toBe(false);
	});

	it('matches the ref like nodeRefMatches does', () => {
		expect(issueMatchesText(issue, '5JZCS5M')).toBe(true);
		expect(issueMatchesText(issue, '5jz-cs5m')).toBe(true);
		expect(issueMatchesText(issue, 'zcs5')).toBe(true);
		expect(issueMatchesText(issue, '5JZCS5X')).toBe(false);
	});

	it('does not match on the rest of the id', () => {
		expect(issueMatchesText(issue, '01KS22')).toBe(false);
	});
});
