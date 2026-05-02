import {Box, Text} from 'ink';
import React, {useEffect} from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {isSuccess} from '../model/result-types.js';
import {nodes} from '../state/node-builder.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';
import {CursorUI} from './Cursor.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	id: string;
	label: string;
	text: string;
	height: number;
	selected: boolean;
	maxWidth: number;
};

export const InlineEditor: React.FC<Props> = ({
	id,
	label,
	text,
	height,
	selected,
	maxWidth,
}) => {
	const {selectedIndex, currentNode} = useAppState();

	const renderMarkdownInline = (md: string) => String(md).replace(/\r?\n/g, '');

	const rows =
		typeof text === 'string' ? text.split(/\r?\n|\u2028|\u2029/) : [];

	useEffect(() => {
		const createdIds: string[] = [];

		rows.forEach((row, idx) => {
			const node = nodes.text({
				id: `${idx}`,
				name: `Line ${idx + 1}`,
				parentNodeId: id,
				props: {value: row},
				readonly: true,
			});

			const result = nodeRepo.createNodeAtPosition(node);
			if (isSuccess(result)) {
				createdIds.push(result.value.id);
			}
		});

		return () => createdIds.forEach(nodeRepo.deleteNode);
	}, [id, text]);

	const EMPTY_ROW_FALLBACK = '\u2029';

	const renderedItems = rows.map((row, i) => {
		const isSel = currentNode.id === id && selectedIndex === i;
		return (
			<Box key={`${id}-${i}`}>
				<Text
					color={isSel ? theme.primary : theme.secondary2}
					dimColor={!isSel}
				>
					{`${i + 1}   `.padStart(5, '\u00A0')}
				</Text>
				<Text backgroundColor={isSel ? 'gray' : ''}>
					{renderMarkdownInline(
						row.length
							? truncateWithEllipsis(row, maxWidth - 10)
							: EMPTY_ROW_FALLBACK,
					)}
				</Text>
			</Box>
		);
	});

	return (
		<Box flexDirection="column" paddingTop={1}>
			<Box>
				<CursorUI isSelected={selected} />
				<Text color={selected ? theme.accent : theme.secondary2}>{label}</Text>
			</Box>

			<Box
				flexDirection="row"
				borderStyle="round"
				borderColor={theme.secondary}
				paddingLeft={1}
				paddingRight={1}
				marginLeft={1}
			>
				<ScrollBoxUI
					scrollByOne={true}
					children={renderedItems}
					height={height - 2}
					selectedIndex={selectedIndex}
					itemHeight={1}
				/>
			</Box>
		</Box>
	);
};
