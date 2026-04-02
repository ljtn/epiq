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

type Props = {
	field: Field;
	selected: boolean;
	selectedIndex: number;
	currentNode: NavNode<AnyContext>;
};

export const FieldUI: React.FC<Props> = ({
	field,
	selected,
	selectedIndex,
	currentNode,
}) => {
	marked.setOptions({
		renderer: new TerminalRenderer() as any,
	});

	const renderMarkdown = (md: string) => marked.parse(md, {async: false});

	const attachedNodeIds = useRef<string[]>([]);

	const document = field.props.value;
	const documentRows =
		typeof document === 'string' ? document.split(/\r?\n|\u2028|\u2029/) : [];

	useEffect(() => {
		const createdIds: string[] = [];
		const createdNodes: any[] = [];

		documentRows.forEach((row, idx) => {
			const lineId = `${field.id}-line-${idx}`;
			const node = nodes.field(`${idx}`, `Line ${idx + 1}`, field.id, {
				value: row,
			});

			const result = nodeRepo.createNodeAtPosition(node);
			createdNodes.push(result.data);
			if (isSuccess(result)) {
				createdIds.push(result.data.id);
			} else {
				logger.info('EERRORROR -<>');
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
				? `⸬ ${Array.from({length: String(i).length})
						.map(() => ' ')
						.join('')}`
				: `${i + 1}  `) +
				renderMarkdown(
					row.length ? truncateWithEllipsis(row, 40 - 6) : EMPTY_ROW_FALLBACK,
				)}
		</Text>
	));

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
				<ScrollBoxUI
					children={renderedItems}
					height={8}
					selectedIndex={selectedIndex}
					itemHeight={1}
				/>
			</Box>
		</Box>
	);
};
