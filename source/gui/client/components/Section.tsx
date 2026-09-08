import React from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

export const Section = ({
	title,
	action,
	children,
	first = false,
	tone,
}: {
	first?: boolean;
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	// A series colour, when the section draws from one the rest of the app
	// already colours — the timeline's green for commits, its accent for the
	// board. Carried by a mark beside the title rather than by the title
	// itself: a heading is text, and text wears ink.
	tone?: string;
}) => (
	<section
		style={{
			padding: first ? '0px 0 20px 0' : '20px 0',
			borderTop: first ? 'none' : `1px solid ${GUI_THEME.line}`,
		}}
	>
		<div
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				gap: 12,
			}}
		>
			<span
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 7,
					color: GUI_THEME.secondary,
					fontSize: TEXT.label,
					textTransform: 'uppercase',
					letterSpacing: '0.08em',
				}}
			>
				{tone && (
					<span
						aria-hidden
						style={{
							// The event log's own dot, to the pixel: same size, same
							// round, so a colour means the same thing in both places.
							width: 5,
							height: 5,
							borderRadius: '50%',
							background: tone,
							flexShrink: 0,
						}}
					/>
				)}
				{title}
			</span>

			{action}
		</div>

		{children}
	</section>
);
