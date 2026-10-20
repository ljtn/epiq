import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconLaneStats} from './IconLaneStats';
import {Button} from './Button';
import {FormHeader} from './FormHeader';

// A board's or a lane's panel: its description, and what can be said about
// it. Kin to a ticket's panel, and named for what it belongs to so it is not
// read as one.

// Opens a board's or a lane's panel. A dot says it has a description: the
// conventions agents are handed there, worth reading before working in it.
export const DetailsButton = ({
	testId,
	title,
	open,
	described,
	onClick,
}: {
	testId: string;
	title: string;
	open: boolean;
	described: boolean;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) => (
	<span style={{position: 'relative', display: 'flex'}}>
		<IconButton testId={testId} title={title} pressed={open} onClick={onClick}>
			<IconLaneStats size={ICON_SIZE} />
		</IconButton>

		{described && (
			<span
				data-testid={`${testId}-marker`}
				style={{
					position: 'absolute',
					top: 2,
					right: 2,
					width: 5,
					height: 5,
					borderRadius: 999,
					background: GUI_THEME.accent,
					pointerEvents: 'none',
				}}
			/>
		)}
	</span>
);

export const DetailsHeader = ({
	testId,
	kind,
	title,
	onClose,
}: {
	testId: string;
	kind: 'Board' | 'Swimlane';
	title: string;
	onClose: () => void;
}) => (
	<FormHeader testId={testId}>
		<div
			style={{
				display: 'flex',
				alignItems: 'baseline',
				gap: 8,
				minWidth: 0,
			}}
		>
			<span
				style={{
					color: GUI_THEME.accent,
					fontSize: 10,
					letterSpacing: 1,
					textTransform: 'uppercase',
					flexShrink: 0,
				}}
			>
				{kind}
			</span>
			<span
				style={{
					fontSize: 13,
					fontWeight: 600,
					color: GUI_THEME.primary,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					minWidth: 0,
				}}
			>
				{title}
			</span>
		</div>

		<Button variant="ghost" onClick={onClose} title="Close">
			×
		</Button>
	</FormHeader>
);
