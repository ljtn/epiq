import {Box, Text} from 'ink';
import React from 'react';
import {Field} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {marked} from 'marked';
import TerminalRenderer from 'marked-terminal';

type Props = {
	field: Field;
	selected: boolean;
};

export const FieldUI: React.FC<Props> = ({field, selected}) => {
	marked.setOptions({
		renderer: new TerminalRenderer() as any,
	});

	const renderMarkdown = (md: string) => marked.parse(md, {async: false}); // sync

	const EMPTY_PLACEHOLDER = ' ';
	const value = field.props['value'] || EMPTY_PLACEHOLDER;
	let rendered: string;
	if (typeof value == 'string') {
		rendered = renderMarkdown(value);
	} else {
		rendered = String(value);
	}
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
				<Text>{rendered}</Text>
			</Box>
		</Box>
	);
};
