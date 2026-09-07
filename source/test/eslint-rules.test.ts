import {Linter} from 'eslint';
import {describe, expect, it} from 'vitest';
import {epiqPlugin} from '../scripts/eslint-rules.mjs';

const lint = (code: string) =>
	new Linter().verify(code, {
		plugins: {epiq: epiqPlugin},
		rules: {'epiq/no-raw-control-characters': 'error'},
	});

// Written as codePointAt-built strings rather than as literals: a raw control
// character in this file would make it binary to git, which is the whole
// point of the rule.
const raw = (code: number) => String.fromCharCode(code);

describe('no-raw-control-characters', () => {
	it('reports a raw NUL, naming its escape', () => {
		const messages = lint(`const a = "x${raw(0)}y";`);

		expect(messages).toHaveLength(1);
		expect(messages[0]!.message).toContain('U+0000');
		expect(messages[0]!.message).toContain('\\x00');
	});

	it('reports every one of them, not just the first', () => {
		expect(lint(`const a = "${raw(1)}${raw(0x1e)}";`)).toHaveLength(2);
	});

	// The escape is ASCII in the file, so it is not what the rule is about.
	it('leaves an escape alone', () => {
		expect(lint('const a = "x\\x00y\\u001ez";')).toHaveLength(0);
	});

	it('leaves tabs and newlines alone', () => {
		expect(lint('const a = 1;\n\tconst b = 2;\n')).toHaveLength(0);
	});
});
