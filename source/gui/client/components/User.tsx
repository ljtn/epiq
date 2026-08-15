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
			background: 'transparent',
			color: user.color,
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
