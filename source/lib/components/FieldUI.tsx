import {Box, Text} from 'ink';
import React from 'react';
import {Field} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

type Props = {
	field: Field;
	selected: boolean;
};

export const FieldUI: React.FC<Props> = ({field, selected}) => {
	const EMPTY_PLACEHOLDER = ' ';
	return (
		<Box flexDirection="column" paddingTop={1}>
			{/* Label */}
			<Text color={selected ? theme.primary : theme.secondary}>
				{' ' + field.title}:
			</Text>

			{/* Value Box */}
			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={selected ? theme.accent : theme.secondary}
				paddingLeft={1}
				paddingRight={1}
			>
				<Text>{field.props['value'] || EMPTY_PLACEHOLDER}</Text>
			</Box>
		</Box>
	);
};
