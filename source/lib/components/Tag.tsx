import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {theme} from '../theme/themes.js';
import {stringToHslHexColor} from '../utils/color.js';
import {nodeRepo} from '../actions/add-item/node-repo.js';

type Props = {
	id: string;
	isSelected?: boolean;
};

const normalizeTagName = (value: string): string => value.toLowerCase().trim();

export const getTagColor = (
	name: string,
	config: TagsDefault = TAGS_DEFAULT,
): TagColor => {
	const normalized = normalizeTagName(name);
	if (config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};

export const TagUI: React.FC<Props> = ({id}) => {
	const tag = nodeRepo.getTag(id);
	if (!tag) return;
	return (
		<Text backgroundColor={getTagColor(tag.name)} color={theme.primary}>
			{' ' + tag.name + ' '}
		</Text>
	);
};
