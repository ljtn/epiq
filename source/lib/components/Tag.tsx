import {Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../repository/node-repo.js';
import {theme} from '../theme/themes.js';
import {getStringColor} from '../utils/color.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';

type Props = {
	id: string;
	isSelected?: boolean;
	maxWidth?: number;
};

export const TagUI: React.FC<Props> = ({id, isSelected, maxWidth}) => {
	const tag = nodeRepo.getTag(id);
	if (!tag) return;

	const name =
		maxWidth === undefined
			? tag.name
			: truncateWithEllipsis(tag.name, maxWidth);
	return (
		<Text
			underline={isSelected}
			backgroundColor={getStringColor(tag.name)}
			color={theme.secondary}
		>
			{' ' + name + ' '}
		</Text>
	);
};
