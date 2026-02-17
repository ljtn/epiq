import {Box, Text} from 'ink';
import React from 'react';
import {TicketField} from '../model/context.model.js';
import {fileManager} from '../storage/file-manager.js';
import {theme} from '../theme/themes.js';

type Props = {
	field: TicketField;
};

export const TicketFieldUI: React.FC<Props> = ({field}) => {
	const descriptionNode = field.name === 'Description';
	let value = field.value;
	if (descriptionNode) {
		const descriptionId = descriptionNode ? field.value : undefined;
		value = descriptionId ? fileManager.getIssue(descriptionId) : '';
	}
	return (
		<Box
			flexDirection="row"
			borderStyle={'round'}
			borderColor={theme.secondary}
		>
			<Box minWidth={20}>
				<Text color={theme.secondary}>{field.name}:</Text>
			</Box>
			<Text color={field.isSelected ? theme.accent : theme.primary}>
				{value}
			</Text>
		</Box>
	);
};
