import React from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {ICON_BUTTON_SIZE} from './IconButton';

export const Section = ({
	title,
	action,
	children,
	first = false,
	focusProps,
}: {
	first?: boolean;
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	// For a section that follows the focus inside it — see lib/use-add-row.
	focusProps?: Pick<
		React.DOMAttributes<HTMLElement>,
		'onFocus' | 'onBlur' | 'onMouseDown'
	>;
}) => (
	<section
		{...focusProps}
		style={{
			padding: first ? '0 0 18px' : '18px 0',
			borderTop: first ? 'none' : `1px solid ${GUI_THEME.line}`,
		}}
	>
		<div
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				gap: 12,
				// As tall as the control it may carry, whether it carries one:
				// the body below must not move when an action comes or goes,
				// or a description jumps as it opens to edit.
				minHeight: ICON_BUTTON_SIZE,
			}}
		>
			<span
				style={{
					color: GUI_THEME.dim,
					fontSize: TEXT.label,
					textTransform: 'uppercase',
					letterSpacing: '0.08em',
				}}
			>
				{title}
			</span>

			{action}
		</div>

		{children}
	</section>
);
