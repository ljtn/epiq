import {Text} from 'ink';
import React from 'react';
import {getStringColor} from '../utils/color.js';
import {nodeRepo} from '../repository/node-repo.js';
import {hasAuthoredEvents} from '../utils/contributor.utils.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';

type Props = {
	id: string;
	isSelected?: boolean;
	maxWidth?: number;
};

export const AssigneeUI: React.FC<Props> = ({id, isSelected, maxWidth}) => {
	const contributor = nodeRepo.getContributor(id);
	if (!contributor) return;

	const displayName = contributor.name;
	const name =
		maxWidth === undefined
			? displayName
			: truncateWithEllipsis(displayName, maxWidth);

	return (
		<Text underline={isSelected} color={getStringColor(displayName)}>
			{'@' + name}
			{hasAuthoredEvents(id) ? '' : '↗'}
		</Text>
	);
};
