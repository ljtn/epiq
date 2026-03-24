import {Box, Text} from 'ink';
import React from 'react';
import {FieldList} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {useAppState} from '../state/state.js';
import {TagUI} from './Tag.js';
import {AssigneeUI} from './Assignee.js';
import {filterMap} from '../utils/array.utils.js';

type Props = {
	fieldList: FieldList;
	selected: boolean;
};
export const FieldListUI: React.FC<Props> = ({fieldList, selected}) => {
	const {currentNode, selectedIndex, nodes} = useAppState();
	const fieldListChildren = filterMap(fieldList.children, id => nodes[id]);
	return (
		<Box flexDirection="column" paddingTop={1}>
			<Text color={selected ? theme.primary : theme.secondary}>
				{' ' + fieldList.name}:
			</Text>

			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={selected ? theme.accent : theme.secondary}
				paddingLeft={1}
				paddingRight={1}
			>
				{!fieldListChildren.length ? <Text> </Text> : ''}
				{fieldListChildren.map((field, index) => (
					<Box>
						<Text color={theme.secondary}>{index > 0 ? ', ' : ''}</Text>
						<Text
							color={
								currentNode.id === fieldList.id && selectedIndex === index
									? theme.accent
									: theme.secondary
							}
						>
							{currentNode.id === fieldList.id && selectedIndex === index
								? '⸬ '
								: '  '}
						</Text>
						{field.name === 'seed:fieldName:assignee' && (
							<AssigneeUI
								name={field.props['value'] ?? ''}
								isSelected={
									currentNode.id === fieldList.id && selectedIndex === index
								}
							></AssigneeUI>
						)}
						{field.name === 'seed:fieldName:tag' && (
							<TagUI
								name={field.props['value'] ?? ''}
								isSelected={
									currentNode.id === fieldList.id && selectedIndex === index
								}
							></TagUI>
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
};
