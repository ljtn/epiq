import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {CmdKeywords} from '../command-line/cmd-keywords.js';
import {getCommandIntent} from '../command-line/command-intent.js';
import {getCmdModifiers} from '../command-line/command-modifiers.js';
import {commands} from '../command-line/commands.js';
import {Mode} from '../model/action-map.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useCmdState} from '../state/cmd.state.js';
import {nodes} from '../state/node-builder.js';
import {getState, updateState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	width: number;
	height: number;
};

const PALETTE_ROOT_ID = '__epiq_palette_root__';
const PALETTE_NODE_PREFIX = '__epiq_palette_command__';

type PaletteCommand = {
	command: string;
	description: string;
	isAvailable: boolean;
};

const toPaletteNodeId = (command: string) => `${PALETTE_NODE_PREFIX}${command}`;

const isPaletteNode = (id: string) =>
	id === PALETTE_ROOT_ID || id.startsWith(PALETTE_NODE_PREFIX);

const getPaletteCommands = (normalizedMatch: string): PaletteCommand[] => {
	const availableCommands = new Set(getCmdModifiers(CmdKeywords.NONE));

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

const attachPaletteNodes = (items: PaletteCommand[]) => {
	updateState(state => {
		const paletteRoot = createPaletteRootNode(state.rootNodeId);

		const nonPaletteNodes = Object.fromEntries(
			Object.entries(state.nodes).filter(([id]) => !isPaletteNode(id)),
		);

		const paletteNodes = Object.fromEntries(
			items.map((item, index) => {
				const node = createPaletteNode(item, index, PALETTE_ROOT_ID);
				return [node.id, node];
			}),
		);

		return {
			...state,
			mode: Mode.PALETTE,
			contextNodeId: PALETTE_ROOT_ID,
			selectedIndex: items.length > 0 ? 0 : -1,
			nodes: {
				...nonPaletteNodes,
				[PALETTE_ROOT_ID]: paletteRoot,
				...paletteNodes,
			},
		};
	});
};

const detachPaletteNodes = () => {
	updateState(state => {
		const nextNodes = Object.fromEntries(
			Object.entries(state.nodes).filter(([id]) => !isPaletteNode(id)),
		);

		return {
			...state,
			nodes: nextNodes,
			contextNodeId:
				state.contextNodeId === PALETTE_ROOT_ID
					? state.rootNodeId
					: state.contextNodeId,
			selectedIndex: 0,
		};
	});
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
			<Box paddingX={1}>
				<Text color={theme.accent}>Command Palette</Text>
				<Text dimColor> — select a command and press enter</Text>
			</Box>

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
							borderColor={theme.secondary}
							borderStyle="single"
						>
							<Text
								color={commandColor}
								dimColor={!item.isAvailable}
								backgroundColor={
									isSelected && item.isAvailable ? theme.secondary : undefined
								}
							>
								{isSelected ? '❯ ' : '  '}
								{':' + item.command}
							</Text>

							<Box paddingLeft={2}>
								<Text dimColor={!item.isAvailable} color={theme.secondary2}>
									{descriptionPrefix + item.description}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
