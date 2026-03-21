import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {stringToHslHexColor} from '../utils/color.js';

type Props = {
	name: string;
	isSelected?: boolean;
};

const normalizeName = (value: string): string => value.toLowerCase().trim();

export const getColor = (
	name: string,
	config: TagsDefault = TAGS_DEFAULT,
): TagColor => {
	const normalized = normalizeName(name);
	if (config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};

export const AssigneeUI: React.FC<Props> = ({name}) => (
	<Text color={getColor(name)}>{' @' + name + ' '}</Text>
);
