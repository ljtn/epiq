import {GUI_THEME} from '../lib/gui-theme';

// A heading that divides: a word and a rule running out from it to the edge.
// The menus draw it between their groups, the settings panel over its cards;
// each sets the word's size and the row's spacing, the shape is this.
export const SectionRule = ({
	label,
	labelStyle,
	style,
}: {
	label: string;
	labelStyle?: React.CSSProperties;
	style?: React.CSSProperties;
}) => (
	<div
		aria-hidden
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			...style,
		}}
	>
		<span
			style={{
				textTransform: 'uppercase',
				color: GUI_THEME.dim,
				whiteSpace: 'nowrap',
				userSelect: 'none',
				...labelStyle,
			}}
		>
			{label}
		</span>
		<span style={{flex: 1, height: 1, background: GUI_THEME.line}} />
	</div>
);
