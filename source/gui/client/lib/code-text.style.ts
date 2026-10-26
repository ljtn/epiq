import {CSSProperties} from 'react';
import {TEXT} from './gui-theme';

/**
 * How code is set across the app. CSS variables, so the highlighter inherits
 * them through its shadow root.
 */
export const CODE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Sized for the app's mono text, and a line grid anything drawn alongside the
// highlighter (a gutter, an annotation) has to land on.
export const CODE_LINE_HEIGHT = 20;

export const CODE_TEXT_VARS = {
	'--diffs-font-family': CODE_FONT,
	'--diffs-font-size': `${TEXT.ui}px`,
	'--diffs-line-height': `${CODE_LINE_HEIGHT}px`,
	// The file path above a diff is chrome, so it follows the app's chrome
	// rather than the sans stack the highlighter would pick for it.
	'--diffs-header-font-family': CODE_FONT,
} as CSSProperties;
