import React, {useContext} from 'react';
import {createPortal} from 'react-dom';
import {GUI_THEME} from '../lib/gui-theme';
import {PANE_HEADER_INSET} from '../lib/pane-header.style';
import {AsideHeaderSlot} from './Aside';

// The header row of whichever panel is open on the right. Portalled into the
// Aside's band above the scrolling pane (see AsideHeaderSlot).
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
				alignItems: 'center',
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
