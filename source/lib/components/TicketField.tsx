import {Box, Text} from 'ink';
import {marked} from 'marked';
import {markedTerminal} from 'marked-terminal';
import React, {useEffect, useState} from 'react';
import {TicketField} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

marked.use(markedTerminal() as any);

type Props = {
	field: TicketField;
	selected: boolean;
};

export const TicketFieldUI: React.FC<Props> = ({field, selected}) => {
	const [value, setValue] = useState<string>('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			const rendered = await marked.parse(field.value);
			if (!cancelled) setValue(rendered);
		})();

		return () => {
			cancelled = true;
		};
	}, [field.value]);

	return (
		<Box flexDirection="column" paddingTop={1}>
			<Text color={selected ? theme.primary : theme.secondary}>
				{' ' + field.title}:
			</Text>
			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={selected ? theme.accent : theme.secondary}
				paddingLeft={1}
				paddingRight={1}
			>
				<Text>{value || ' '}</Text>
			</Box>
		</Box>
	);
};
