import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {stringToHslHexColor} from '../utils/color.js';
import {nodeRepo} from '../../repository/node-repo.js';

type Props = {
	id: string;
	isSelected?: boolean;
};

const normalizeName = (value: string): string => value.toLowerCase().trim();

export const getColor = (
	id: string,
	config: TagsDefault = TAGS_DEFAULT,
): TagColor => {
	const normalized = normalizeName(id);
	if (config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};

export const AssigneeUI: React.FC<Props> = ({id}) => {
	const contributor = nodeRepo.getContributor(id);
	if (!contributor) return;
	return (
		<Text color={getColor(contributor.name)}>
			{' @' + contributor.name + ' '}
		</Text>
	);
};
