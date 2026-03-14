import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	isSelected: boolean;
	user: {initials: 'JL'};
};
export const UserBadgeUI: React.FC<Props> = ({user, isSelected: selected}) => {
	return (
		<Box marginRight={1}>
			<Text color={selected ? theme.accent : theme.primary}>
				{'' + user.initials + ''}
			</Text>
		</Box>
	);
};
