import {Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../repository/node-repo.js';
import {theme} from '../theme/themes.js';
import {getStringColor} from '../utils/color.js';

type Props = {
	id: string;
	isSelected?: boolean;
};

export const TagUI: React.FC<Props> = ({id, isSelected}) => {
	const tag = nodeRepo.getTag(id);
	if (!tag) return;
	return (
		<Text
			underline={isSelected}
			backgroundColor={getStringColor(tag.name)}
			color={theme.primary}
		>
			{' ' + tag.name + ' '}
		</Text>
	);
};
