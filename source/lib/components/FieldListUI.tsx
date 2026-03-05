import {Box, Text} from 'ink';
import React from 'react';
import {FieldList} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {useAppState} from '../state/state.js';

type Props = {
	fieldList: FieldList;
	selected: boolean;
};
export const FieldListUI: React.FC<Props> = ({fieldList, selected}) => {
	const {currentNode, selectedIndex} = useAppState();
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
				{fieldList.children.map((field, index) => (
					<Box>
						<Text color={theme.secondary}>{index > 0 ? ', ' : ''}</Text>
						<Text
							backgroundColor={theme.secondary}
							color={
								currentNode.id === fieldList.id && selectedIndex === index
									? theme.accent
									: theme.secondary
							}
						>
							{' ' + field.props['value'] + ' '}
						</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
};
