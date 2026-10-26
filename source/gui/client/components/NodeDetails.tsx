import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {FormHeader} from './FormHeader';

// A board's or a lane's panel: its description, and what can be said about
// it. Kin to a ticket's panel, and named for what it belongs to so it is not
// read as one.

export const DetailsHeader = ({
	testId,
	kind,
	title,
	onClose,
}: {
	testId: string;
	kind: 'Board' | 'Swimlane' | 'Goal';
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
