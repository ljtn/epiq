import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {theme} from '../theme/themes.js';
import {stringToHslHexColor} from '../utils/color.js';

type Props = {
	name: string;
	isSelected?: boolean;
};

const normalizeTagName = (value: string): string => value.toLowerCase().trim();

export const getTagBackgroundColor = (
	name: string,
	config: TagsDefault = TAGS_DEFAULT,
): TagColor => {
	const normalized = normalizeTagName(name);
	if (config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};

export const TagUI: React.FC<Props> = ({name}) => (
	<Text backgroundColor={getTagBackgroundColor(name)} color={theme.primary}>
		{' ' + name + ' '}
	</Text>
);
