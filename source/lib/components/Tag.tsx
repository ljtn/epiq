import {Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	name: string;
	selected?: boolean;
};
export const TagUI: React.FC<Props> = ({name, selected}) => {
	return (
		<Text
			backgroundColor={theme.secondary}
			color={selected ? theme.accent : theme.primary}
		>
			{' ' + name + ' '}
		</Text>
	);
};
