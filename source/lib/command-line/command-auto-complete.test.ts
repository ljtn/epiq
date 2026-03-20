import {describe, expect, it} from 'vitest';
import {getAutoCompletion} from './command-auto-complete.js';

describe('getAutoCompletion (remainder)', () => {
	it('returns remainder for command completion ("ta" → "tag")', () => {
		expect(getAutoCompletion('ta').remainder).toBe('g ');
	});

	it('returns remainder for modifier completion ("tag c" → "critical")', () => {
		expect(getAutoCompletion('tag c').remainder).toBe('ritical ');
	});

	it('returns remainder for command completion ("vi" → "view")', () => {
		expect(getAutoCompletion('vi').remainder).toBe('ew ');
	});

	it('returns remainder for modifier completion ("view d" → "dense")', () => {
		expect(getAutoCompletion('view d').remainder).toBe('ense ');
	});

	it('returns remainder for modifier completion ("view w" → "wide")', () => {
		expect(getAutoCompletion('view w').remainder).toBe('ide ');
	});

	it('returns empty remainder when no completion is available ("add ")', () => {
		expect(getAutoCompletion('add ').remainder).toBe('');
	});

	it('returns empty remainder when no matching completion exists ("tag critical crime")', () => {
		expect(getAutoCompletion('tag critical crime').remainder).toBe('');
	});

	it('returns remainder for word completion ("add fron" → "frontend")', () => {
		expect(getAutoCompletion('add fron').remainder).toBe('tend ');
	});

	it('is case-insensitive for completion ("add Fron" → "frontend")', () => {
		expect(getAutoCompletion('add Fron').remainder).toBe('tend ');
	});
});
