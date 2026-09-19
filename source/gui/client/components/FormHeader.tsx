import React, {useContext} from 'react';
import {createPortal} from 'react-dom';
import {GUI_THEME} from '../lib/gui-theme';
import {PANE_HEADER_INSET} from '../lib/pane-header.style';
import {AsideHeaderSlot} from './Aside';

// The row at the top of the panel on the right, whichever panel that is: a
// ticket, a commit's diff, a lane's figures, a bulk selection. One band for all
// four, so the ref and the buttons sit where the eye already learned they are,
// on the line the board's switcher and the log's fields keep.
//
// Written inside its panel, drawn above the pane: the band it lands in is the
// Aside's, outside the scrolling (see AsideHeaderSlot). That is what the log
// does on the other side of the board, and it is why the scrollbar here belongs
// to the body and stops at this row rather than running up beside it.
export const FormHeader = ({
	children,
	testId,
}: {
	children: React.ReactNode;
	testId?: string;
}) => {
	const slot = useContext(AsideHeaderSlot);

	const band = (
		<div
			data-testid={testId}
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'flex-start',
				gap: 12,
				padding: `${PANE_HEADER_INSET}px 0`,
				// The log's header draws the same rule, for the same reason: it is
				// what the body below stops against.
				borderBottom: `1px solid ${GUI_THEME.line}`,
				marginBottom: 10,
			}}
		>
			{children}
		</div>
	);

	// Rendered in place for the one render before the band exists, and outside
	// an Aside altogether — a panel drawn somewhere else keeps its header.
	return slot ? createPortal(band, slot) : band;
};
