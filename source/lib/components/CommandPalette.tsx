import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {CmdKeywords} from '../command-line/cmd-keywords.js';
import {getCommandIntent} from '../command-line/command-intent.js';
import {getCmdModifiers} from '../command-line/command-modifiers.js';
import {isTextNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {useCmdState} from '../state/cmd.state.js';
import {nodes} from '../state/node-builder.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {ulid} from 'ulid';
import {capitalize} from '../utils/string.utils.js';
import {getUiState} from '../state/ux-state.js';
import {commands} from '../command-line/commands.js';

const HighlightMatch = ({
	text,
	match,
	color,
	highlightColor = theme.secondary,
	dimColor = false,
}: {
	text: string;
	match: string;
	color?: string;
	highlightColor?: string;
	dimColor?: boolean;
}) => {
	if (!match) {
		return (
			<Text color={color} dimColor={dimColor}>
				{text}
			</Text>
		);
	}

	const lowerText = text.toLowerCase();
	const lowerMatch = match.toLowerCase();
	const index = lowerText.indexOf(lowerMatch);

	if (index === -1) {
		return (
			<Text color={color} dimColor={dimColor}>
				{text}
			</Text>
		);
	}

	return (
		<Text color={color} dimColor={dimColor}>
			{text.slice(0, index)}
			<Text backgroundColor={highlightColor} bold>
				{text.slice(index, index + match.length)}
			</Text>
			{text.slice(index + match.length)}
		</Text>
	);
};

type Props = {
	width: number;
	height: number;
};

const PALETTE_ROOT_ID = ulid();

type PaletteCommand = {
	command: string;
	description: string;
	isAvailable: boolean;
};

const toPaletteNodeId = (command: string) => `${command}`;

const getPaletteCommands = (normalizedMatch: string): PaletteCommand[] => {
	const {pendingNavTarget} = getUiState();
	if (!pendingNavTarget) return [];
	const {breadCrumb, contextNode, selectedNode} = pendingNavTarget;
	const availableCommands = new Set(
		getCmdModifiers(CmdKeywords.NONE, {
			breadCrumb,
			contextNode,
			readOnly: getState().readOnly,
			selectedNode,
		}),
	);

	return [...new Set(Object.values(CmdKeywords))]
		.filter(command => command !== 'move')
		.filter(command => command.length > 0)
		.filter(command => command !== CmdKeywords.PALETTE)
		.map(command => {
			const intent = getCommandIntent(command);
			const commandMeta = commands.find(c => c.intent === intent);

			return {
				command,
				description: commandMeta?.description ?? `[${command}] Run command`,
				isAvailable: availableCommands.has(command),
			};
		})
		.filter(paletteOption => {
			const descriptionMatchThreshold = 2;

			return (
				paletteOption.command.toLowerCase().startsWith(normalizedMatch) ||
				(normalizedMatch.length >= descriptionMatchThreshold &&
					paletteOption.description.toLowerCase().includes(normalizedMatch))
			);
		})
		.sort((a, b) => {
			if (a.isAvailable !== b.isAvailable) {
				return a.isAvailable ? -1 : 1;
			}

			return a.command.localeCompare(b.command);
		});
};

const createPaletteRootNode = (parentNodeId: string): NavNode<'TEXT'> =>
	nodes.text({
		id: PALETTE_ROOT_ID,
		parentNodeId,
		rank: '000000',
		name: 'Command Palette',
		props: {},
		readonly: true,
		isVirtual: true,
	});

const createPaletteNode = (
	command: PaletteCommand,
	index: number,
	parentNodeId: string,
): NavNode<'TEXT'> =>
	nodes.text({
		id: toPaletteNodeId(command.command),
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		name: command.command,
		props: {
			value: command.description,
			disabled: !command.isAvailable,
		},
		readonly: true,
		isVirtual: true,
	});

let paletteNodes: NavNode<'TEXT'>[] = [];

const attachPaletteNodes = (paletteCmd: PaletteCommand[]) => {
	detachPaletteNodes();
	const rootNodeResult = nodeRepo.createNode(
		createPaletteRootNode(getState().rootNodeId),
	);
	if (isFail(rootNodeResult) || !isTextNode(rootNodeResult.value)) return;

	paletteNodes = [
		rootNodeResult.value,
		...paletteCmd
			.map((item, i) => createPaletteNode(item, i, PALETTE_ROOT_ID))
			.map(nodeRepo.createNode)
			.filter(isSuccess)
			.map(({value}) => value)
			.filter(isTextNode),
	];

	navigationUtils.navigate({
		contextNode: rootNodeResult.value,
		selectedIndex: 0,
	});
};

const detachPaletteNodes = () => {
	const ids = paletteNodes.map(node => node.id);
	paletteNodes = [];

	for (const id of ids) nodeRepo.deleteNode(id);
};

export function CommandPalette({width, height}: Props) {
	const cmdState = useCmdState();
	const matchValue = cmdState.value.trim().toLowerCase();
	const items = useMemo(() => getPaletteCommands(matchValue), [matchValue]);

	useEffect(() => {
		attachPaletteNodes(items);

		return () => {
			detachPaletteNodes();
		};
	}, [items]);

	const selectedIndex = getState().selectedIndex;

	return (
		<Box flexDirection="column" width={width} height={height - 2}>
			<ScrollBoxUI
				height={height - 4}
				itemHeight={3}
				selectedIndex={selectedIndex}
			>
				{items.map((item, index) => {
					const isSelected = index === selectedIndex;
					const commandColor = item.isAvailable
						? theme.accent
						: theme.secondary2;

					const descriptionPrefix = item.isAvailable ? '' : '[unavailable] ';

					return (
						<Box
							key={item.command}
							flexDirection="column"
							paddingX={1}
							borderLeft={false}
							borderBottom={false}
							borderRight={false}
							borderColor={theme.secondary}
							borderStyle="single"
						>
							<Text color={commandColor} dimColor={!item.isAvailable}>
								{isSelected ? '❯ ' : '  '}
								<HighlightMatch
									text={capitalize(item.command)}
									match={matchValue}
									color={commandColor}
									dimColor={!item.isAvailable}
								/>
							</Text>

							<Box paddingLeft={2}>
								<HighlightMatch
									text={descriptionPrefix + item.description}
									match={matchValue.length >= 2 ? matchValue : ''}
									color={
										isSelected && item.isAvailable
											? theme.primary
											: theme.secondary2
									}
									dimColor={!item.isAvailable}
								/>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
