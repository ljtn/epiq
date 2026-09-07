// The diff's syntax theme: github-dark, with one thing changed.
//
// Every editor theme there is paints comments grey and recedes them, on the
// premise that they are not the code. That is exactly backwards for reading
// somebody else's change: a comment is the only part of a diff that says *why*,
// and it is the part a reviewer most wants to find. So comments come forward in
// the same yellow the Stats tab uses for them — if a line is worth writing in
// prose, it is worth reading.

import {registerCustomTheme, resolveTheme} from '@pierre/diffs';

const BASE_THEME = 'github-dark';

export const EPIQ_DIFF_THEME = 'epiq-dark';

// The Stats tab's comment share wears this too, so the bar and the file agree
// about which half is prose.
export const COMMENT_COLOR = '#ffd479';

// A tmTheme rule's scope is one selector or a list of them, and a comment is
// scoped `comment` or `comment.line…`/`comment.block…` depending on the
// grammar. Matching the prefix catches every shape without catching, say,
// `constant`.
const isCommentScope = (scope: string | string[] | undefined): boolean =>
	(Array.isArray(scope) ? scope : [scope ?? '']).some(
		selector =>
			selector === 'comment' ||
			selector.startsWith('comment.') ||
			selector.startsWith('comment '),
	);

let registered = false;

/**
 * Idempotent, and called for its side effect: the highlighter resolves a theme
 * by name, so the name has to be known before the first diff renders. Both
 * call sites (the ticket's Commits tab and the scrubber's own diff panel) call
 * this at module load.
 */
export const registerEpiqDiffTheme = (): void => {
	if (registered) return;
	registered = true;

	registerCustomTheme(EPIQ_DIFF_THEME, async () => {
		const base = await resolveTheme(BASE_THEME);

		return {
			...base,
			name: EPIQ_DIFF_THEME,
			settings: base.settings.map(setting =>
				isCommentScope(setting.scope)
					? {
							...setting,
							settings: {
								...setting.settings,
								foreground: COMMENT_COLOR,
								// github-dark leaves comments upright; italics on top of
								// the colour would be shouting twice.
							},
					  }
					: setting,
			),
		};
	});
};

registerEpiqDiffTheme();
