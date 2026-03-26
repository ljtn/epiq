import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';

type Props = {
	title: string;
	items: string[];
};
export const FieldListUI: React.FC<Props> = ({items, title}) => {
	logger.info(items);
	return (
		<Box flexDirection="column" paddingTop={1}>
			<Text color={theme.secondary}>{' ' + title}:</Text>

			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={theme.secondary}
				paddingLeft={1}
				paddingRight={1}
			>
				{items.map(item => (
					<Box>
						{title === 'assignees' ? (
							<AssigneeUI id={item}></AssigneeUI>
						) : title === 'tags' ? (
							<TagUI id={item}></TagUI>
						) : (
							''
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
};
