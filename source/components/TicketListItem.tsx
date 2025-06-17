import React from 'react';
import {Text} from 'ink';

export const TicketListItem: React.FC<{name: string}> = ({name}) => (
	<Text>- {name}</Text>
);
