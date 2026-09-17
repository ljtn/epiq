import React from 'react';
import {GUI_THEME} from './gui-theme';

// One of a row of mutually exclusive choices — the scrubber's period, the Diff
// tab's commits-or-compacted. Underlined rather than filled, so a row of them
// reads as a set of options with one taken, not a row of buttons one of which
// happens to be lit.
export const segmentedButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: 'none',
	borderBottom: `1px solid ${active ? GUI_THEME.accent : 'transparent'}`,
	color: active ? GUI_THEME.primary : GUI_THEME.dim,
	borderRadius: 0,
	fontSize: 11,
	padding: '2px 6px 3px',
	cursor: 'pointer',
});
