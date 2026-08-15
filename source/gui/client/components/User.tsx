import {GuiUser, GuiState} from '../lib/gui-state.model';

export const User = ({
	user,
	index,
	isFocus,
}: {
	user: GuiState['user'];
	index?: number;
	isFocus?: boolean;
}) => (
	<span
		key={user.id}
		title={user.name}
		style={{
			width: 20,
			height: 20,
			borderRadius: '50%',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			// Outlined rather than filled: a solid disc outweighs everything else
			// on an otherwise all-text card.
			background: 'transparent',
			color: user.color,
			border: `1px solid ${user.color}`,
			fontSize: 11,
			fontWeight: 700,
			// Spaced, not stacked: overlapping needs opaque discs to occlude, and
			// these are rings.
			marginLeft: index === 0 ? 0 : 4,
			flexShrink: 0,
		}}
	>
		{user.name.at(0)?.toUpperCase()}
	</span>
);
