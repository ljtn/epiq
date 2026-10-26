import {CSSProperties} from 'react';
import {GUI_THEME} from './gui-theme';

// Armed rows say "destructive": the confirm button's own red, translucent
// enough that the name's own colour still reads against it.
const ARMED_BACKGROUND = 'rgba(255, 135, 135, 0.14)';

/**
 * One row of a manage-and-delete modal, shared by tags and contributors.
 * Armed outranks hover.
 */
export const manageRowStyle = ({
	armed,
	hovered,
}: {
	armed: boolean;
	hovered: boolean;
}): CSSProperties => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 8,
	padding: '6px 8px',
	borderRadius: 6,
	background: armed
		? ARMED_BACKGROUND
		: hovered
		? GUI_THEME.line
		: 'transparent',
	// An inset ring rather than a border, so arming a row does not reflow it.
	boxShadow: armed ? `inset 0 0 0 1px ${GUI_THEME.red}` : undefined,
});
