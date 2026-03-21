import {describe, expect, it} from 'vitest';
import {getAutoCompletion} from '../command-auto-complete.js';
import {parseCommandLine} from '../command-parser.js';

describe('getAutoCompletion (remainder)', () => {
	it('returns remainder for command completion ("ta" → "tag")', () => {
		const parsed = parseCommandLine('ta');
		expect(getAutoCompletion(parsed).remainder).toBe('g ');
	});

	it('returns remainder for modifier completion ("tag c" → "critical")', () => {
		const parsed = parseCommandLine('tag c');
		expect(getAutoCompletion(parsed).remainder).toBe('ritical ');
	});

	it('returns remainder for command completion ("vi" → "view")', () => {
		const parsed = parseCommandLine('vi');
		expect(getAutoCompletion(parsed).remainder).toBe('ew ');
	});

	it('returns remainder for modifier completion ("view d" → "dense")', () => {
		const parsed = parseCommandLine('view d');
		expect(getAutoCompletion(parsed).remainder).toBe('ense ');
	});

	it('returns remainder for modifier completion ("view w" → "wide")', () => {
		const parsed = parseCommandLine('view w');
		expect(getAutoCompletion(parsed).remainder).toBe('ide ');
	});

	it('returns empty remainder when no completion is available ("new ")', () => {
		const parsed = parseCommandLine('new ');
		expect(getAutoCompletion(parsed).remainder).toBe('');
	});

	it('returns empty remainder when no matching completion exists ("tag critical crime")', () => {
		const parsed = parseCommandLine('tag critical crime');
		expect(getAutoCompletion(parsed).remainder).toBe('');
	});

	it('returns remainder for word completion ("new iss" → "ue")', () => {
		const parsed = parseCommandLine('new iss');
		expect(getAutoCompletion(parsed).remainder).toBe('ue ');
	});

	it('returns remainder for word completion ("new issue fron" → "frontend")', () => {
		const parsed = parseCommandLine('new issue fron');
		expect(getAutoCompletion(parsed).remainder).toBe('tend ');
	});

	it('is case-insensitive for completion ("new issue Fron" → "frontend")', () => {
		const parsed = parseCommandLine('new issue Fron');
		expect(getAutoCompletion(parsed).remainder).toBe('tend ');
	});
});
