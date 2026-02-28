import {Box, Text} from 'ink';
import React from 'react';
import {TicketField} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

type Props = {
	field: TicketField;
	selected: boolean;
};

export const TicketFieldUI: React.FC<Props> = ({field, selected}) => {
	return (
		<Box flexDirection="column" paddingTop={1}>
			{/* Label */}
			<Text color={selected ? theme.primary : theme.secondary}>
				{' ' + field.fields.title}:
			</Text>

			{/* Value Box */}
			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={selected ? theme.accent : theme.secondary}
				paddingLeft={1}
				paddingRight={1}
			>
				<Text>{field.fields.value}</Text>
			</Box>
		</Box>
	);
};
