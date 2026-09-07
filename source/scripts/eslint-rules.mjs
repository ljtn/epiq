// Local rules, kept here with the other tooling scripts rather than published
// as a plugin: they exist for this repository's own hazards.

// Tab and newline are the two that belong in source text. Everything else
// below U+0020 is a byte somebody meant to write as an escape.
const ALLOWED = new Set(['\t', '\n']);

/**
 * Git classifies a file holding a control character as binary: no diff, no
 * blame, no review of it on GitHub, from then on. `grep` treats it as binary
 * too and silently finds nothing, so searching for the line you are looking at
 * reports it missing. Neither prettier nor tsc says a word, both being valid
 * string contents — which is how one reached a pull request as
 * `Bin 0 -> 3009 bytes`.
 *
 * Escapes (`\0`, `\x1e`) are ASCII in the file and unaffected; this is about
 * the raw byte only. `no-control-regex` covers regexes, and
 * `no-irregular-whitespace` its own list — neither covers source text.
 */
const noRawControlCharacters = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow raw control characters in source text',
		},
		schema: [],
		messages: {
			raw: 'Raw control character U+{{code}}. Write it as an escape ({{escape}}) — a file containing one is binary to git and to grep.',
		},
	},

	create(context) {
		return {
			Program() {
				const text = context.sourceCode.getText();

				for (let index = 0; index < text.length; index++) {
					const character = text[index];

					if (character >= ' ' || ALLOWED.has(character)) continue;

					const code = character.charCodeAt(0);

					context.report({
						loc: context.sourceCode.getLocFromIndex(index),
						messageId: 'raw',
						data: {
							code: code.toString(16).toUpperCase().padStart(4, '0'),
							escape: `\\x${code.toString(16).padStart(2, '0')}`,
						},
					});
				}
			},
		};
	},
};

export const epiqPlugin = {
	rules: {'no-raw-control-characters': noRawControlCharacters},
};
