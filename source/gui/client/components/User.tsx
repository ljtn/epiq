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
			// Outlined rather than filled: a solid disc is the heaviest mark on
			// a card that is otherwise all text, and it competed with the title
			// for attention. A thin ring carries the same identity colour at a
			// fraction of the visual weight.
			background: 'transparent',
			color: user.color,
			border: `1px solid ${user.color}`,
			fontSize: 11,
			fontWeight: 700,
			// Spaced, not stacked. Overlapping avatars rely on each disc being
			// opaque to occlude the one behind it; with transparent rings the
			// overlap reads as tangled circles instead of a stack.
			marginLeft: index === 0 ? 0 : 4,
			flexShrink: 0,
		}}
	>
		{user.name.at(0)?.toUpperCase()}
	</span>
);
