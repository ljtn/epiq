import {GuiUser, GuiState} from '../lib/gui-state.model';
import {getContrastTextColor} from '../lib/gui-theme';

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
			background: user.color,
			color: getContrastTextColor(user.color),
			fontSize: 11,
			fontWeight: 700,
			marginLeft: index === 0 ? 0 : -6,
			border: `2px solid #1a1a1a`,
		}}
	>
		{user.name.at(0)?.toUpperCase()}
	</span>
);
