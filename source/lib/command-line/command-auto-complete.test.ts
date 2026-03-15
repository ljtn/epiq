import {describe, expect, it} from 'vitest';
import {getAutoCompletion} from './command-auto-complete.js';

describe('getHint', () => {
	it('suggests command hint for "ta"', () => {
		expect(getAutoCompletion('ta')).toBe('tag ');
	});

	it('suggests modifier hint for "tag c"', () => {
		expect(getAutoCompletion('tag c')).toBe('critical ');
	});

	it('suggests command hint for "vi"', () => {
		expect(getAutoCompletion('vi')).toBe('view ');
	});

	it('suggests modifier hint for "view d"', () => {
		expect(getAutoCompletion('view d')).toBe('dense ');
	});

	it('suggests modifier hint for "view w"', () => {
		expect(getAutoCompletion('view w')).toBe('wide ');
	});

	it('does not suggests autocompletion for "add " ', () => {
		expect(getAutoCompletion('add ')).toBe('');
	});

	it('does not suggests autocompletion for "tag critical cri" ', () => {
		expect(getAutoCompletion('tag critical crime')).toBe('');
	});
});
