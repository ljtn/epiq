import chalk from 'chalk';
import {Box, Text} from 'ink';
import {marked} from 'marked';
import TerminalRenderer from 'marked-terminal';
import React, {useEffect, useRef} from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {isSuccess} from '../command-line/command-types.js';
import {AnyContext, Field} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodes} from '../state/node-builder.js';
import {theme} from '../theme/themes.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {CursorUI} from './Cursor.js';

type Props = {
	height: number;
	field: Field;
	selected: boolean;
	selectedIndex: number;
	currentNode: NavNode<AnyContext>;
	maxWidth: number;
};

export const FieldUI: React.FC<Props> = ({
	height,
	field,
	selected,
	selectedIndex,
	currentNode,
	maxWidth,
}) => {
	marked.setOptions({
		renderer: new TerminalRenderer() as any,
	});

	const renderMarkdownInline = (md: string) =>
		String(marked.parseInline(md)).replace(/\r?\n/g, '');

	const attachedNodeIds = useRef<string[]>([]);

	const document = field.props.value;
	const documentRows =
		typeof document === 'string' ? document.split(/\r?\n|\u2028|\u2029/) : [];

	useEffect(() => {
		const createdIds: string[] = [];
		const createdNodes: any[] = [];

		documentRows.forEach((row, idx) => {
			const lineId = `${field.id}-line-${idx}`;
			const node = nodes.text(`${idx}`, `Line ${idx + 1}`, field.id, {
				value: row,
			});

			const result = nodeRepo.createNodeAtPosition(node);
			createdNodes.push(result.data);
			if (isSuccess(result)) {
				createdIds.push(result.data.id);
			} else {
				createdIds.push(lineId);
			}
		});

		attachedNodeIds.current = createdIds;

		return () => {
			attachedNodeIds.current.forEach(nodeRepo.deleteNode);
			attachedNodeIds.current = [];
		};
	}, [field.id]);

	const EMPTY_ROW_FALLBACK = '\u2029';

	const renderedItems = documentRows.map((row, i) => (
		<Text key={`${field.id}-${i}`}>
			{(currentNode.id === field.id && selectedIndex === i
				? chalk.cyan(
						`▸ ${Array.from({length: String(i).length})
							.map(() => ' ')
							.join('')}`,
				  )
				: chalk.dim.gray(`${i + 1}  `)) +
				renderMarkdownInline(
					row.length
						? truncateWithEllipsis(row, maxWidth - 10)
						: EMPTY_ROW_FALLBACK,
				)}
		</Text>
	));

	return (
		<Box flexDirection="column" paddingTop={1}>
			<Box>
				<CursorUI isSelected={selected}></CursorUI>
				<Text color={selected ? theme.accent : theme.secondary}>
					{field.title + ' (press I to edit)'}
				</Text>
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
					height={height}
					selectedIndex={selectedIndex}
					itemHeight={1}
				/>
			</Box>
		</Box>
	);
};
