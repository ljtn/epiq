import {CSSProperties} from 'react';
import {TEXT} from './gui-theme';

/**
 * How code is set wherever the app shows it: the diff panel, a commit's files,
 * a snippet quoted into a comment. The highlighter's own defaults are a step
 * larger than the app's mono chrome and set in a sans stack, which reads as a
 * different app embedded in this one — these pin it to the surrounding text
 * instead. Everything is a CSS variable the highlighter reads, so it inherits
 * through its shadow root from whatever element carries this.
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
