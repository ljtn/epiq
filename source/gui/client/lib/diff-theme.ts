// The diff's syntax theme: github-dark with comments brought forward in the
// Stats tab's yellow, since they say why.

import {registerCustomTheme, resolveTheme} from '@pierre/diffs';
import {COMMENT_YELLOW} from './issue-stats.style';

const BASE_THEME = 'github-dark';

export const EPIQ_DIFF_THEME = 'epiq-dark';

// The Stats tab's comment share wears the same value, so the bar and the file
// agree about which half is prose.
const COMMENT_COLOR = COMMENT_YELLOW;

// Comment scopes are `comment`, `comment.line…` or `comment.block…`.
const isCommentScope = (scope: string | string[] | undefined): boolean =>
	(Array.isArray(scope) ? scope : [scope ?? '']).some(
		selector =>
			selector === 'comment' ||
			selector.startsWith('comment.') ||
			selector.startsWith('comment '),
	);

let registered = false;

/**
 * Idempotent; must run before the first diff renders, since the highlighter
 * resolves the theme by name.
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
