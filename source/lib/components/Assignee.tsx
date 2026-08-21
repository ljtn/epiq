import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {stringToHslHexColor} from '../utils/color.js';
import {nodeRepo} from '../repository/node-repo.js';
import {
	getContributorDisplayName,
	hasAuthoredEvents,
} from '../utils/contributor.utils.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';

type Props = {
	id: string;
	isSelected?: boolean;
	maxWidth?: number;
};

const normalizeName = (value: string): string => value.toLowerCase().trim();

export const getStringColor = (
	id: string,
	config: TagsDefault = TAGS_DEFAULT,
): TagColor => {
	const normalized = normalizeName(id);
	if (config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};

export const AssigneeUI: React.FC<Props> = ({id, isSelected, maxWidth}) => {
	const contributor = nodeRepo.getContributor(id);
	if (!contributor) return;

	const displayName = getContributorDisplayName(id, contributor.name);
	const name =
		maxWidth === undefined
			? displayName
			: truncateWithEllipsis(displayName, maxWidth);

	return (
		<Text underline={isSelected} color={getStringColor(name)}>
			{'@' + name}
			{hasAuthoredEvents(id) ? '' : '↗'}
		</Text>
	);
};
