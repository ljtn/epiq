import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {getState} from '../state/state.js';

type Props = {
	title: string;
	items: string[];
	selected: boolean;
};
export const FieldListUI: React.FC<Props> = ({items, title, selected}) => {
	return (
		<Box alignItems="center" paddingTop={1}>
			<Box minWidth={16}>
				<Text color={selected ? theme.accent : theme.secondary}>
					{' ' + title}:
				</Text>
			</Box>

			<Box flexDirection="row" marginLeft={1} paddingRight={1} paddingLeft={1}>
				{items.map(item => (
					<Box paddingRight={2} minHeight={1}>
						{item === getState().currentNode.id ? (
							<Text color={theme.accent}>⸬</Text>
						) : (
							<Text>⸬ </Text>
						)}
						{title === 'Assignees' ? (
							<AssigneeUI id={item}></AssigneeUI>
						) : title === 'Tags' ? (
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
