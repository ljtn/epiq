import {Text} from 'ink';
import React from 'react';
import {TagColor, TAGS_DEFAULT, TagsDefault} from '../static/default-tags.js';
import {stringToHslHexColor} from '../utils/color.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';

type Props = {
	id: string;
	isSelected?: boolean;
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

// Somebody assigned who has never authored an event on this workspace — see
// getAssignableContributors. Marked rather than hidden: an outsider on a
// ticket is legitimate, but worth being able to tell apart from a teammate at
// a glance. Derived from the log, so it stops showing the moment they
// contribute.
const isExternalContributor = (contributorId: string): boolean => {
	const {eventLog = []} = getState();

	return !eventLog.some(event => event.userId === contributorId);
};

export const AssigneeUI: React.FC<Props> = ({id, isSelected}) => {
	const contributor = nodeRepo.getContributor(id);
	if (!contributor) return;

	return (
		<Text underline={isSelected} color={getStringColor(contributor.name)}>
			{'@' + contributor.name}
			{isExternalContributor(id) ? '↗' : ''}
		</Text>
	);
};
