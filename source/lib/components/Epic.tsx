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

// Drawn like a tag but bracketed, so a glance tells the one bucket a ticket is
// in apart from the several labels it carries.
export const EpicUI: React.FC<Props> = ({id, isSelected, maxWidth}) => {
	const epic = nodeRepo.getEpic(id);
	if (!epic) return;

	const name =
		maxWidth === undefined
			? epic.name
			: truncateWithEllipsis(epic.name, maxWidth);

	return (
		<Text
			underline={isSelected}
			backgroundColor={getStringColor(epic.name)}
			color={theme.secondary}
		>
			{'«' + name + '»'}
		</Text>
	);
};
