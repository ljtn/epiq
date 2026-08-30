import {describe, expect, it} from 'vitest';
import {checkCommitRef, commitTicketRef} from '../lib/utils/commit-ref.js';

// Real shape: a ULID whose last 7 characters are the ref.
const ids = [
	'01M1778Y02CREYS7FATB8PYTCM', // B8PYTCM
	'01M179WTBBX27A6EKNHW1TCS14', // W1TCS14
	'01M173GJWM4Y8WJERKNVW1Z3QE', // VW1Z3QE
];

const check = (subject: string) => checkCommitRef(subject, ids);

describe('checkCommitRef', () => {
	it('accepts a correct ref', () => {
		expect(check('B8PYTCM refuse to commit a log that lost lines').ok).toBe(
			true,
		);
	});

	it('accepts a correct ref in any case', () => {
		expect(check('b8pytcm refuse to commit a log that lost lines').ok).toBe(
			true,
		);
	});

	// The mistake that actually happened, four times, silently.
	it('rejects a ref with its leading character dropped, and names the right one', () => {
		const verdict = check('8PYTCM refuse to commit a log that lost lines');

		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.reason).toContain('B8PYTCM');
		expect(verdict.reason).toContain('Did you mean');
	});

	it.each([
		['51H3F1', '01M1779BKX3JDXXRV4AF51H3F1'],
		['2WFGV2', '01M179VVM90T6SXFP17E2WFGV2'],
		['1TCS14', '01M179WTBBX27A6EKNHW1TCS14'],
	])('rejects the truncated ref %s', (truncated, fullId) => {
		expect(checkCommitRef(`${truncated} some subject`, [fullId]).ok).toBe(
			false,
		);
	});

	it('rejects a ref-shaped token that matches no ticket', () => {
		const verdict = check('ZZZZZZZ do a thing');

		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.reason).toContain('matches no ticket');
	});

	// Not every commit carries a ref, and demanding one would make this a
	// nuisance instead of a safety net.
	it.each([
		'make ticket refs in comments and descriptions clickable',
		'epiq skill: never test against the real board',
		'fix the scrubber',
	])('accepts an ordinary subject with no ref: %s', subject => {
		expect(check(subject).ok).toBe(true);
	});

	// Crockford excludes I, L, O and U, which is what keeps ordinary words out
	// of the ref-shaped bucket.
	it.each([
		'BUILD the thing', // U
		'POLISH the panel', // O, I
		'INLINE the helper', // I
		'RELOAD on change', // O
	])('accepts an uppercase word that cannot be a ref: %s', subject => {
		expect(check(subject).ok).toBe(true);
	});

	it.each([
		'Merge pull request #121 from ljtn/worktree-sync-lock',
		'Revert "B8PYTCM refuse to commit a log that lost lines"',
		'fixup! B8PYTCM refuse to commit',
		'squash! B8PYTCM refuse to commit',
		'[epiq:init]',
		'[sync|branch:main:sha:3ea7e6e3]',
	])('accepts the subject git or epiq writes itself: %s', subject => {
		expect(check(subject).ok).toBe(true);
	});

	it('accepts anything when the board is unknown', () => {
		expect(checkCommitRef('B8PYTCM do a thing', []).ok).toBe(true);
	});

	it('accepts an empty subject rather than guessing', () => {
		expect(check('   ').ok).toBe(true);
	});

	// Short enough to sit inside two different refs: no confident correction,
	// so no rejection.
	it('stays quiet when a short token could belong to several refs', () => {
		expect(
			checkCommitRef('CS1 do a thing', [
				'01M179WTBBX27A6EKNHW1TCS14',
				'01M179WTBBX27A6EKNHW1TCS1X',
			]).ok,
		).toBe(true);
	});
});

describe('commitTicketRef', () => {
	const known = new Set(['ABCDEFG', '1234567']);

	it('is the leading token when it is a known ref, whatever its case', () => {
		expect(commitTicketRef('abcdefg fix the thing', known)).toBe('ABCDEFG');
		expect(commitTicketRef('  1234567 tidy', known)).toBe('1234567');
	});

	it('is null for a subject that links nowhere', () => {
		expect(commitTicketRef('BUILD the thing', known)).toBeNull();
		expect(commitTicketRef('fix ABCDEFG later', known)).toBeNull();
		expect(commitTicketRef('', known)).toBeNull();
	});
});
