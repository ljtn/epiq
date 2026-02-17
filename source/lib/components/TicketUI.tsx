import {Box} from 'ink';
import React from 'react';
import {TicketField} from '../model/context.model.js';
import {fileManager} from '../storage/file-manager.js';
import {theme} from '../theme/themes.js';
import {TicketFieldUI} from './TicketField.js';

type Props = {
	ticket: TicketField;
	width: number;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, width, height}) => {
	const descriptionNode = ticket.children.find(x => x.name === 'Description');
	const descriptionId = descriptionNode?.value;
	const description = descriptionId ? fileManager.getIssue(descriptionId) : '';
	debug('Description', description);
	return (
		<Box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			borderStyle="round"
			width={width}
			minHeight={height}
			borderColor={theme.secondary}
		>
			{ticket.children.map((child, index) => (
				<TicketFieldUI key={index} field={child}></TicketFieldUI>
			))}
		</Box>
	);
};
