import {GuiUser, GuiState} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';

export const User = ({
	user,
	index,
	isFocus,
	filled = false,
}: {
	user: GuiState['user'];
	index?: number;
	isFocus?: boolean;
	/** Solid in the user's colour, the letter cut out of it: for a pressed state. */
	filled?: boolean;
}) => (
	<span
		key={user.id}
		title={user.name}
		style={{
			width: 18,
			height: 18,
			borderRadius: '50%',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			background: filled ? user.color : 'transparent',
			color: filled ? GUI_THEME.chrome : user.color,
			border: `1px solid ${user.color}`,
			fontSize: 11,
			fontWeight: 700,
			marginLeft: index === 0 ? 0 : 4,
			flexShrink: 0,
		}}
	>
		{user.name.at(0)?.toUpperCase()}
	</span>
);
